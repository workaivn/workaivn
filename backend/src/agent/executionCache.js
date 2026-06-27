import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DEBUG = () => process.env.DEBUG_AGENT === 'true' || process.env.WORKAI_AGENT_DEBUG === 'true';

const sharedExecutionCaches = new Map();

export function getSharedExecutionCache(workspaceRoot = '') {
  const key = String(workspaceRoot || '__default__').replace(/\\/g, '/').toLowerCase();
  if (!sharedExecutionCaches.has(key)) {
    sharedExecutionCaches.set(key, createExecutionCache());
  }
  return sharedExecutionCaches.get(key);
}

export function createExecutionCache() {
  const readCache = new Map();
  const terminalCache = new Map();
  const fileDeps = new Map();
  const commandDeps = new Map();

  const stats = {
    readFile: { total: 0, cacheHits: 0 },
    writeFile: { total: 0, skipped: 0 },
    runTerminal: { total: 0, cacheHits: 0 },
    cacheMisses: 0,
    cacheStores: 0,
    invalidations: 0,
    estimatedTimeSavedMs: 0,
    startTime: Date.now(),
  };

  const norm = (p) => String(p || '').replace(/\\/g, '/');

  async function getFileInfo(filePath) {
    try {
      const stat = await fs.stat(filePath);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  }

  function buildDepHash(deps) {
    if (!deps || deps.length === 0) return '';
    const sorted = [...deps].sort((a, b) => a.file.localeCompare(b.file));
    const str = sorted.map(d => `${d.file}:${d.mtimeMs}:${d.size}`).join('|');
    return crypto.createHash('md5').update(str).digest('hex');
  }

  async function resolveAbsolute(workspaceRoot, filePath) {
    if (!workspaceRoot || !filePath) return null;
    const candidate = path.resolve(workspaceRoot, filePath);
    try {
      const resolved = await fs.realpath(candidate);
      return resolved;
    } catch {
      return candidate;
    }
  }

  return {
    /**
     * READ_FILE cache lookup.
     * Returns cached content if file mtime+size unchanged, otherwise null.
     * When workspaceRoot is null (no disk), returns cached content without verification.
     */
    async getCachedRead(filePath, workspaceRoot) {
      stats.readFile.total++;
      const key = norm(filePath);
      const cached = readCache.get(key);
      if (!cached) {
        console.log('[CACHE_MISS]', { tool: 'READ_FILE', path: key });
        stats.cacheMisses++;
        return null;
      }
      // Without workspaceRoot, serve cached content without file-system verification
      if (!workspaceRoot) {
        stats.readFile.cacheHits++;
        console.log('[READ_CACHE_HIT]', { path: key });
        return cached.content;
      }
      const absPath = await resolveAbsolute(workspaceRoot, filePath);
      if (!absPath) {
        console.log('[CACHE_MISS]', { tool: 'READ_FILE', path: key, reason: 'no_resolve' });
        stats.cacheMisses++;
        return null;
      }
      const currentInfo = await getFileInfo(absPath);
      if (!currentInfo || currentInfo.mtimeMs !== cached.fileInfo.mtimeMs || currentInfo.size !== cached.fileInfo.size) {
        readCache.delete(key);
        console.log('[CACHE_MISS]', { tool: 'READ_FILE', path: key, reason: 'file_changed' });
        stats.cacheMisses++;
        return null;
      }
      stats.readFile.cacheHits++;
      console.log('[READ_CACHE_HIT]', { path: key });
      return cached.content;
    },

    /**
     * READ_FILE cache store.
     */
    async setCachedRead(filePath, content, workspaceRoot) {
      const key = norm(filePath);
      let fileInfo = null;
      if (workspaceRoot) {
        const absPath = await resolveAbsolute(workspaceRoot, filePath);
        if (absPath) {
          fileInfo = await getFileInfo(absPath);
        }
      }
      if (!fileInfo) {
        fileInfo = { mtimeMs: Date.now(), size: String(content || '').length };
      }
      readCache.set(key, { content, fileInfo, timestamp: Date.now() });
      stats.cacheStores++;
      console.log('[CACHE_STORE]', { tool: 'READ_FILE', path: key, size: String(content || '').length });
    },

    /**
     * WRITE_FILE dedup: compare existing content vs new content.
     * Returns { skipped: true } if identical, otherwise { skipped: false }.
     * Invalidates affected caches if file changes.
     */
    async shouldSkipWrite(filePath, content, workspaceRoot) {
      stats.writeFile.total++;
      const key = norm(filePath);
      if (!workspaceRoot) {
        stats.writeFile.skipped++;
        return { skipped: false };
      }
      const absPath = await resolveAbsolute(workspaceRoot, filePath);
      if (!absPath) {
        stats.writeFile.skipped++;
        return { skipped: false };
      }
      try {
        const existing = await fs.readFile(absPath, 'utf8');
        if (existing === String(content || '')) {
          stats.writeFile.skipped++;
          console.log('[WRITE_SKIPPED_NO_CHANGE]', { path: key });
          return { skipped: true };
        }
      } catch {
        // File doesn't exist — not a skip
      }
      return { skipped: false };
    },

    /**
     * Invalidate all caches that depend on the given file.
     * Checks by exact path, relative path, and basename for robust matching.
     */
    invalidateFile(filePath) {
      const key = norm(filePath);
      const base = path.basename(key);
      readCache.delete(key);
      // Collect all terminal commands to invalidate
      const toInvalidate = new Set();
      const lookupKeys = [key, base];
      for (const lookup of lookupKeys) {
        const affected = fileDeps.get(lookup);
        if (affected) {
          for (const cmd of affected) toInvalidate.add(cmd);
        }
      }
      // Also scan all terminals for dependency matching
      for (const [cmd, entry] of terminalCache) {
        if (!entry.invalidated && entry.deps) {
          for (const dep of entry.deps) {
            const depKey = norm(dep.relativePath || dep.file);
            const depBase = path.basename(depKey);
            if (depKey === key || depBase === base) {
              toInvalidate.add(cmd);
              break;
            }
          }
        }
      }
      // Invalidate all collected terminals
      for (const cmd of toInvalidate) {
        const entry = terminalCache.get(cmd);
        if (entry) {
          entry.invalidated = true;
          console.log('[CACHE_INVALIDATED]', { file: key, command: cmd });
          stats.invalidations++;
        }
      }
    },

    /**
     * RUN_TERMINAL cache lookup.
     * Returns cached result if same command + same dependency hash, exitCode===0.
     */
    async getCachedTerminal(command, workspaceRoot) {
      stats.runTerminal.total++;
      const cmd = String(command || '').trim();
      const cached = terminalCache.get(cmd);
      if (!cached || cached.invalidated) {
        console.log('[CACHE_MISS]', { tool: 'RUN_TERMINAL', command: cmd, reason: cached?.invalidated ? 'invalidated' : 'not_found' });
        stats.cacheMisses++;
        return null;
      }
      if (cached.exitCode !== 0) {
        console.log('[CACHE_MISS]', { tool: 'RUN_TERMINAL', command: cmd, reason: 'non_zero_exit' });
        stats.cacheMisses++;
        return null;
      }
      // Verify dependency hash
      if (cached.deps && cached.deps.length > 0) {
        const fileInfos = [];
        for (const dep of cached.deps) {
          const filePath = dep.file;
          const info = await getFileInfo(filePath).catch(() => null);
          if (!info) {
            // Dependency file was deleted — cache invalid
            terminalCache.delete(cmd);
            console.log('[CACHE_MISS]', { tool: 'RUN_TERMINAL', command: cmd, reason: 'dependency_deleted', file: dep.relativePath || dep.file });
            stats.cacheMisses++;
            return null;
          }
          fileInfos.push({ file: filePath, mtimeMs: info.mtimeMs, size: info.size });
        }
        const currentHash = buildDepHash(fileInfos);
        if (currentHash !== cached.depHash) {
          terminalCache.delete(cmd);
          console.log('[CACHE_MISS]', { tool: 'RUN_TERMINAL', command: cmd, reason: 'dependency_changed' });
          stats.cacheMisses++;
          return null;
        }
      }
      stats.runTerminal.cacheHits++;
      console.log('[TERMINAL_CACHE_HIT]', { command: cmd });
      return {
        success: true,
        stdout: cached.stdout,
        stderr: cached.stderr,
        exitCode: cached.exitCode,
        cached: true,
      };
    },

    /**
     * RUN_TERMINAL cache store.
     * Stores result + dependency file info.
     * Dependency keys are stored as BOTH relative path and basename for robust invalidation.
     */
    async setCachedTerminal(command, result, sourceFiles, workspaceRoot) {
      const cmd = String(command || '').trim();
      const deps = [];
      const seen = new Set();
      if (sourceFiles && sourceFiles.length > 0) {
        for (const f of sourceFiles) {
          const key = norm(f);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          let absPath = null;
          if (workspaceRoot) {
            absPath = await resolveAbsolute(workspaceRoot, f);
          }
          const filePath = absPath || key;
          const info = await getFileInfo(filePath).catch(() => null);
          if (info) {
            deps.push({ file: filePath, relativePath: key, mtimeMs: info.mtimeMs, size: info.size });
          }
        }
      }
      const depHash = deps.length > 0 ? buildDepHash(deps) : '';
      const entry = {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode,
        deps,
        depHash,
        timestamp: Date.now(),
        invalidated: false,
      };
      terminalCache.set(cmd, entry);
      // Build file→command reverse mapping using BOTH relative path and basename
      if (deps.length > 0) {
        commandDeps.set(cmd, deps.map(d => d.relativePath));
        for (const dep of deps) {
          const keys = new Set([dep.relativePath, path.basename(dep.relativePath)]);
          for (const depKey of keys) {
            if (!fileDeps.has(depKey)) fileDeps.set(depKey, new Set());
            fileDeps.get(depKey).add(cmd);
          }
        }
      }
      stats.cacheStores++;
      console.log('[CACHE_STORE]', { tool: 'RUN_TERMINAL', command: cmd, exitCode: result.exitCode, deps: deps.length });
    },

    async get(tool, args = {}, context = {}) {
      if (tool === 'READ_FILE') {
        const filePath = args.path || args.file;
        const content = await this.getCachedRead(filePath, context.workspaceRoot);
        return content == null ? null : { success: true, file: filePath, content, cached: true };
      }
      if (tool === 'RUN_TERMINAL') {
        return await this.getCachedTerminal(args.command, context.workspaceRoot);
      }
      return null;
    },

    async set(tool, args = {}, context = {}, result = {}) {
      if (tool === 'READ_FILE' && result?.success !== false && result.content != null) {
        await this.setCachedRead(result.file || args.path || args.file, result.content, context.workspaceRoot);
      }
      if (tool === 'RUN_TERMINAL' && result?.success !== false && Number(result.exitCode) === 0) {
        await this.setCachedTerminal(args.command, result, context.sourceFiles || [], context.workspaceRoot);
      }
    },

    /**
     * Record time saved by cache hits (estimated).
     */
    recordEstimatedTimeSaved(ms) {
      stats.estimatedTimeSavedMs += ms;
    },

    /**
     * Get current stats.
     */
    getStats() {
      return {
        ...stats,
        readCacheSize: readCache.size,
        terminalCacheSize: terminalCache.size,
        readHitRate: stats.readFile.total > 0 ? (stats.readFile.cacheHits / stats.readFile.total * 100).toFixed(1) : '0.0',
        terminalHitRate: stats.runTerminal.total > 0 ? (stats.runTerminal.cacheHits / stats.runTerminal.total * 100).toFixed(1) : '0.0',
      };
    },

    /**
     * Print tool optimizer summary.
     */
    printSummary() {
      const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);
      const timeSaved = stats.estimatedTimeSavedMs > 0
        ? (stats.estimatedTimeSavedMs / 1000).toFixed(1)
        : '0.0';
      const lines = [
        '',
        '========== Tool Optimizer Summary =========',
        `  READ cache hits:     ${stats.readFile.cacheHits}/${stats.readFile.total}`,
        `  WRITE skipped:       ${stats.writeFile.skipped}/${stats.writeFile.total}`,
        `  TERMINAL cache hits: ${stats.runTerminal.cacheHits}/${stats.runTerminal.total}`,
        `  Cache stores:        ${stats.cacheStores}`,
        `  Cache misses:        ${stats.cacheMisses}`,
        `  Invalidations:       ${stats.invalidations}`,
        `  Estimated time saved: ${timeSaved}s`,
        `  Runtime:             ${duration}s`,
        '===========================================',
      ];
      for (const line of lines) {
        console.log(line);
      }
    },

    /**
     * Clear caches (for testing).
     */
    clear() {
      readCache.clear();
      terminalCache.clear();
      fileDeps.clear();
      commandDeps.clear();
      stats.readFile = { total: 0, cacheHits: 0 };
      stats.writeFile = { total: 0, skipped: 0 };
      stats.runTerminal = { total: 0, cacheHits: 0 };
      stats.cacheMisses = 0;
      stats.cacheStores = 0;
      stats.invalidations = 0;
      stats.estimatedTimeSavedMs = 0;
      stats.startTime = Date.now();
    },
  };
}
