import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

export const D2Tool = Tool.define("d2", {
  description: `Generate diagrams from D2 markup language. Creates SVG or PNG files from D2 diagram definitions. Useful for architecture diagrams, UML, flowcharts, sequence diagrams, and entity-relationship diagrams. Requires the 'd2' binary to be installed (https://d2lang.com). Input can be inline D2 code or a path to a .d2 file.`,
  parameters: z.object({
    input: z.string().describe("D2 markup code OR path to a .d2 file"),
    output: z.string().describe("Output file path (e.g., 'docs/diagrams/arch.svg')"),
    format: z.enum(["svg", "png"]).optional().default("svg").describe("Output format"),
    theme: z.string().optional().describe("D2 theme (e.g., 'neutral', 'dark')"),
    layout: z.enum(["dagre", "elk", "tala"]).optional().describe("Layout engine"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "bash",
      patterns: ["d2 *"],
      always: ["d2 *"],
    })

    const dir = path.dirname(params.output)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let inputFile = params.input
    let tempFile: string | null = null

    // If input is inline D2 code (not a file path), write to temp file
    if (params.input.includes("->") || params.input.includes(":") || params.input.includes("{")) {
      tempFile = path.join(dir, `.devbunker-d2-temp-${Date.now()}.d2`)
      fs.writeFileSync(tempFile, params.input, "utf-8")
      inputFile = tempFile
    }

    try {
      const args = [inputFile, params.output]
      if (params.theme) args.push("--theme", params.theme)
      if (params.layout) args.push("--layout", params.layout)

      const result = execSync(`d2 ${args.join(" ")}`, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: process.cwd(),
      })

      return {
        title: `Generated ${params.format} diagram`,
        metadata: { output: params.output, format: params.format },
        output: `Diagram generated: ${params.output}\n${result}`,
      }
    } catch (e: any) {
      const msg = e.stderr || e.message || String(e)
      if (msg.includes("not found") || msg.includes("not recognized")) {
        return {
          title: "D2 not installed",
          metadata: { error: true },
          output: "Error: 'd2' binary not found. Install it from https://d2lang.com\n\nOn macOS: brew install d2\nOn Linux: curl -fsSL https://d2lang.com/install.sh | sh\nOn Windows: scoop install d2",
        }
      }
      return {
        title: "D2 error",
        metadata: { error: true },
        output: `Error generating diagram: ${msg}`,
      }
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile)
      }
    }
  },
})
