export function createToolOptimizer() {
  const readCache = new Map();
  const terminalCache = new Map();
  const fileDeps = new Map();
  const commandDeps = new Map();

  const stats = {
    readFile: { total: 0, cacheHits: 0 },
    writeFile: { total: 0, skipped: 0 },
    runTerminal: { total: 0, cacheHits: 0 },
    executionTimes: [],
    startTime: Date.now(),
  };

  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

  return {
    getCachedRead(path) {
      const key = norm(path);
      const cached = readCache.get(key);
      stats.readFile.total++;
      if (cached) {
        stats.readFile.cacheHits++;
        console.log('[TOOL_CACHE_HIT]', { tool: 'READ_FILE', path: key });
        return cached.content;
      }
      return null;
    },

    setCachedRead(path, content) {
      const key = norm(path);
      readCache.set(key, { content, timestamp: Date.now() });
    },

    shouldSkipWrite(path, content) {
      const key = norm(path);
      const cached = readCache.get(key);
      if (cached && cached.content === content) return true;
      return false;
    },

    getCachedTerminal(command) {
      const cached = terminalCache.get(command);
      stats.runTerminal.total++;
      if (!cached || cached.invalidated) return null;
      stats.runTerminal.cacheHits++;
      console.log('[TERMINAL_CACHE_HIT]', { command });
      return {
        success: true,
        stdout: cached.stdout,
        stderr: cached.stderr,
        exitCode: cached.exitCode,
      };
    },

    setCachedTerminal(command, result, sourceFiles) {
      const entry = {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode,
        timestamp: Date.now(),
        invalidated: false,
      };
      terminalCache.set(command, entry);
      if (sourceFiles && sourceFiles.length > 0) {
        commandDeps.set(command, sourceFiles.map(norm));
        for (const f of sourceFiles) {
          const key = norm(f);
          if (!fileDeps.has(key)) fileDeps.set(key, new Set());
          fileDeps.get(key).add(command);
        }
      }
    },

    invalidateFile(filePath) {
      const key = norm(filePath);
      readCache.delete(key);
      const affected = fileDeps.get(key);
      if (affected) {
        for (const cmd of affected) {
          const entry = terminalCache.get(cmd);
          if (entry) entry.invalidated = true;
        }
        fileDeps.delete(key);
      }
    },

    recordWrite(skipped) {
      stats.writeFile.total++;
      if (skipped) stats.writeFile.skipped++;
    },

    recordExecutionTime(ms) {
      stats.executionTimes.push(ms);
    },

    printSummary() {
      const avgTime = stats.executionTimes.length > 0
        ? (stats.executionTimes.reduce((a, b) => a + b, 0) / stats.executionTimes.length).toFixed(1)
        : '0';
      const readHitRate = stats.readFile.total > 0
        ? (stats.readFile.cacheHits / stats.readFile.total * 100).toFixed(1)
        : '0.0';
      console.log('[TOOL_OPTIMIZER_SUMMARY]', {
        readFile: {
          total: stats.readFile.total,
          cacheHits: stats.readFile.cacheHits,
          hitRate: `${readHitRate}%`
        },
        writeFile: {
          total: stats.writeFile.total,
          skipped: stats.writeFile.skipped
        },
        runTerminal: {
          total: stats.runTerminal.total,
          cacheHits: stats.runTerminal.cacheHits
        },
        averageExecutionTime: `${avgTime}ms`
      });
    },

    getStats() {
      return { ...stats, readCacheSize: readCache.size, terminalCacheSize: terminalCache.size };
    },
  };
}
