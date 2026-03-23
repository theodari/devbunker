import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

export const PandocTool = Tool.define("pandoc", {
  description: `Convert documents between formats using Pandoc. Primarily used to export Markdown files to PDF, DOCX, or HTML. Requires 'pandoc' to be installed (https://pandoc.org). For PDF output, a LaTeX engine is also needed (or use --pdf-engine=weasyprint for CSS-based PDF).`,
  parameters: z.object({
    input: z.string().describe("Input file path (e.g., 'docs/specs/auth.md')"),
    output: z.string().describe("Output file path (e.g., 'docs/exports/auth.pdf')"),
    from: z.enum(["markdown", "html", "rst", "textile", "latex"]).optional().default("markdown").describe("Input format"),
    to: z.enum(["pdf", "docx", "html", "latex", "rst"]).optional().describe("Output format (inferred from extension if not specified)"),
    toc: z.boolean().optional().default(false).describe("Include table of contents"),
    standalone: z.boolean().optional().default(true).describe("Produce standalone document"),
    template: z.string().optional().describe("Path to custom template file"),
    variables: z.record(z.string(), z.string()).optional().describe("Template variables (e.g., {title: 'My Doc', author: 'Me'})"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "bash",
      patterns: ["pandoc *"],
      always: ["pandoc *"],
    })

    if (!fs.existsSync(params.input)) {
      return {
        title: "File not found",
        metadata: { error: true },
        output: `Error: Input file not found: ${params.input}`,
      }
    }

    const dir = path.dirname(params.output)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    try {
      const args = [params.input, "-o", params.output]
      args.push("-f", params.from || "markdown")
      if (params.to) args.push("-t", params.to)
      if (params.toc) args.push("--toc")
      if (params.standalone) args.push("-s")
      if (params.template) args.push("--template", params.template)
      if (params.variables) {
        for (const [key, value] of Object.entries(params.variables)) {
          args.push("-V", `${key}=${value}`)
        }
      }

      const result = execSync(`pandoc ${args.join(" ")}`, {
        encoding: "utf-8",
        timeout: 60000,
        cwd: process.cwd(),
      })

      const stat = fs.statSync(params.output)
      const sizeKB = Math.round(stat.size / 1024)

      return {
        title: `Exported to ${path.extname(params.output).slice(1).toUpperCase()}`,
        metadata: { output: params.output, sizeKB },
        output: `Document exported: ${params.output} (${sizeKB} KB)\n${result}`,
      }
    } catch (e: any) {
      const msg = e.stderr || e.message || String(e)
      if (msg.includes("not found") || msg.includes("not recognized")) {
        return {
          title: "Pandoc not installed",
          metadata: { error: true },
          output: "Error: 'pandoc' not found. Install it from https://pandoc.org\n\nOn macOS: brew install pandoc\nOn Linux: sudo apt install pandoc\nOn Windows: scoop install pandoc",
        }
      }
      return {
        title: "Pandoc error",
        metadata: { error: true },
        output: `Error converting document: ${msg}`,
      }
    }
  },
})
