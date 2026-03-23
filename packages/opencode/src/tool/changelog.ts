import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

export const ChangelogTool = Tool.define("changelog", {
  description: `Generate a changelog from git commit history. Parses conventional commits (feat:, fix:, docs:, refactor:, etc.) and groups them by type. Can generate for a specific version range or all commits since last tag.`,
  parameters: z.object({
    from: z.string().optional().describe("Start ref (tag or commit). Defaults to last tag."),
    to: z.string().optional().default("HEAD").describe("End ref. Defaults to HEAD."),
    output: z.string().optional().describe("Output file path (e.g., 'CHANGELOG.md'). If omitted, returns content."),
    version: z.string().optional().describe("Version label for this release (e.g., '0.2.0')"),
    append: z.boolean().optional().default(false).describe("Append to existing changelog instead of overwriting"),
  }),
  async execute(params, ctx) {
    if (params.output) {
      await ctx.ask({
        permission: "edit",
        patterns: [params.output],
        always: ["*"],
      })
    }

    try {
      // Find starting point
      let from = params.from
      if (!from) {
        try {
          from = execSync("git describe --tags --abbrev=0 2>/dev/null", { encoding: "utf-8" }).trim()
        } catch {
          from = execSync("git rev-list --max-parents=0 HEAD", { encoding: "utf-8" }).trim()
        }
      }

      const to = params.to || "HEAD"
      const log = execSync(
        `git log ${from}..${to} --format="%H|%s|%an|%aI" --no-merges`,
        { encoding: "utf-8", timeout: 15000 }
      ).trim()

      if (!log) {
        return { title: "No changes", metadata: {}, output: `No commits found between ${from} and ${to}` }
      }

      const categories: Record<string, Array<{ hash: string; msg: string; author: string; date: string }>> = {
        "Features": [],
        "Bug Fixes": [],
        "Documentation": [],
        "Refactoring": [],
        "Performance": [],
        "Tests": [],
        "Chores": [],
        "Other": [],
      }

      const prefixMap: Record<string, string> = {
        "feat": "Features",
        "fix": "Bug Fixes",
        "docs": "Documentation",
        "refactor": "Refactoring",
        "perf": "Performance",
        "test": "Tests",
        "chore": "Chores",
        "build": "Chores",
        "ci": "Chores",
        "style": "Refactoring",
      }

      for (const line of log.split("\n")) {
        if (!line.trim()) continue
        const [hash, subject, author, date] = line.split("|")
        const shortHash = hash.slice(0, 7)

        // Parse conventional commit
        const match = subject.match(/^(\w+)(?:\(.+?\))?!?:\s*(.+)/)
        if (match) {
          const [, type, msg] = match
          const category = prefixMap[type] || "Other"
          categories[category].push({ hash: shortHash, msg, author, date: date.slice(0, 10) })
        } else {
          categories["Other"].push({ hash: shortHash, msg: subject, author, date: date.slice(0, 10) })
        }
      }

      // Build markdown
      const dateStr = new Date().toISOString().slice(0, 10)
      const versionLabel = params.version || to
      let md = `## ${versionLabel} (${dateStr})\n\n`

      for (const [category, entries] of Object.entries(categories)) {
        if (entries.length === 0) continue
        md += `### ${category}\n\n`
        for (const entry of entries) {
          md += `- ${entry.msg} (\`${entry.hash}\`)\n`
        }
        md += "\n"
      }

      if (params.output) {
        const dir = path.dirname(params.output)
        if (dir && !fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        if (params.append && fs.existsSync(params.output)) {
          const existing = fs.readFileSync(params.output, "utf-8")
          // Insert after first heading or at beginning
          const headerMatch = existing.match(/^# .+\n/)
          if (headerMatch) {
            const insertPos = headerMatch[0].length
            const content = existing.slice(0, insertPos) + "\n" + md + existing.slice(insertPos)
            fs.writeFileSync(params.output, content, "utf-8")
          } else {
            fs.writeFileSync(params.output, md + "\n" + existing, "utf-8")
          }
        } else {
          const header = "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n"
          fs.writeFileSync(params.output, header + md, "utf-8")
        }

        return {
          title: `Changelog generated`,
          metadata: { output: params.output, version: versionLabel },
          output: `Changelog written to ${params.output}`,
        }
      }

      return {
        title: `Changelog: ${versionLabel}`,
        metadata: { version: versionLabel },
        output: md,
      }
    } catch (e: any) {
      return {
        title: "Changelog error",
        metadata: { error: true },
        output: `Error generating changelog: ${e.stderr || e.message || String(e)}`,
      }
    }
  },
})
