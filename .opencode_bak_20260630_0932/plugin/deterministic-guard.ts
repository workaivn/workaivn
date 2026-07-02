import type { Plugin } from "@opencode-ai/plugin"

interface DeterministicContext {
  taskId: string
  rootCauseFile: string | null
  resolvedPaths: string[]
  language: string
  moduleSystem: string
  requiredExports: string[]
  allowedTools: string[]
  writeCompatible: boolean
  retryCommand: string | null
  validationConstraints: string[]
}

const globalCtx: { current: DeterministicContext | null } = { current: null }

export default (() => {
  return {
    config: (cfg: Record<string, unknown>) => {
      cfg.deterministicGuard = cfg.deterministicGuard ?? { enabled: true }
    },

    "tool.execute.before": async (input: { tool: string; args: Record<string, unknown> }, output: { args: Record<string, unknown> }) => {
      if (!globalCtx.current) return

      const ctx = globalCtx.current

      if (ctx.allowedTools.length > 0 && !ctx.allowedTools.includes(input.tool)) {
        throw new Error(
          `[DeterministicGuard] Tool "${input.tool}" not in allowed set [${ctx.allowedTools.join(", ")}]. ` +
          `Planner did not authorize this tool.`
        )
      }

      if (["edit", "write"].includes(input.tool) && input.args.filePath) {
        const fp = String(input.args.filePath)
        const allowed = ctx.resolvedPaths.some((p) => fp.startsWith(p))
        if (!allowed) {
          throw new Error(
            `[DeterministicGuard] Write to "${fp}" not authorized. ` +
            `Planner resolved paths: [${ctx.resolvedPaths.join(", ")}].`
          )
        }
        if (!ctx.writeCompatible) {
          throw new Error(
            `[DeterministicGuard] Write not compatible per planner analysis. ` +
            `Re-run planner to reassess write compatibility.`
          )
        }
      }
    },

    "tool.execute.after": async (_input: unknown, output: { result?: unknown }) => {
      if (!globalCtx.current) return
      const ctx = globalCtx.current
      if (ctx.retryCommand && output.result && typeof output.result === "object") {
        const r = output.result as Record<string, unknown>
        if (r.exitCode !== undefined && Number(r.exitCode) !== 0) {
          throw new Error(
            `[DeterministicGuard] Command failed. Planner retry command: ${ctx.retryCommand}`
          )
        }
      }
    },
  }
}) satisfies Plugin

export function setDeterministicContext(ctx: DeterministicContext): void {
  globalCtx.current = ctx
}

export function getDeterministicContext(): DeterministicContext | null {
  return globalCtx.current
}
