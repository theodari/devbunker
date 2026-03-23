import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"

export const GitAdvancedTool = Tool.define("git_advanced", {
  description: `Advanced Git operations for code analysis and history exploration. Provides formatted git log, blame, diff between branches/commits, stash management, and commit statistics. More structured output than raw git commands.`,
  parameters: z.object({
    operation: z.enum(["log", "blame", "diff", "stash-list", "stash-save", "stash-pop", "stats", "contributors", "file-history"]).describe("Git operation to perform"),
    file: z.string().optional().describe("File path (for blame, file-history)"),
    ref: z.string().optional().describe("Git ref - branch, tag, or commit (for log, diff)"),
    ref2: z.string().optional().describe("Second ref for diff comparison"),
    limit: z.number().optional().default(20).describe("Number of entries to show (for log)"),
    message: z.string().optional().describe("Message (for stash-save)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "bash",
      patterns: ["git *"],
      always: ["git *"],
    })

    try {
      let cmd: string
      let title: string

      switch (params.operation) {
        case "log":
          cmd = `git log --oneline --graph --decorate -n ${params.limit}${params.ref ? ` ${params.ref}` : ""}`
          title = "Git Log"
          break

        case "blame":
          if (!params.file) return { title: "Error", metadata: { error: true }, output: "Error: 'file' parameter required for blame" }
          cmd = `git blame --date=short ${params.file}`
          title = `Blame: ${params.file}`
          break

        case "diff":
          if (params.ref && params.ref2) {
            cmd = `git diff ${params.ref}..${params.ref2} --stat`
          } else if (params.ref) {
            cmd = `git diff ${params.ref} --stat`
          } else {
            cmd = `git diff --stat`
          }
          title = "Git Diff"
          break

        case "stash-list":
          cmd = `git stash list`
          title = "Stash List"
          break

        case "stash-save":
          cmd = `git stash push${params.message ? ` -m "${params.message}"` : ""}`
          title = "Stash Saved"
          break

        case "stash-pop":
          cmd = `git stash pop`
          title = "Stash Applied"
          break

        case "stats":
          cmd = `git shortlog -sn --all --no-merges | head -20`
          title = "Commit Statistics"
          break

        case "contributors":
          cmd = `git log --format="%aN <%aE>" --all | sort -u`
          title = "Contributors"
          break

        case "file-history":
          if (!params.file) return { title: "Error", metadata: { error: true }, output: "Error: 'file' parameter required for file-history" }
          cmd = `git log --oneline --follow -n ${params.limit} -- ${params.file}`
          title = `History: ${params.file}`
          break

        default:
          return { title: "Unknown operation", metadata: { error: true }, output: `Unknown operation: ${params.operation}` }
      }

      const result = execSync(cmd, { encoding: "utf-8", timeout: 15000, cwd: process.cwd() })

      return {
        title,
        metadata: { operation: params.operation },
        output: result || "(empty result)",
      }
    } catch (e: any) {
      return {
        title: "Git error",
        metadata: { error: true },
        output: `Error: ${e.stderr || e.message || String(e)}`,
      }
    }
  },
})
