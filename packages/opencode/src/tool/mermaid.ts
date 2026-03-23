import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

export const MermaidTool = Tool.define("mermaid", {
  description: `Generate diagrams from Mermaid markup language. Creates SVG or PNG files from Mermaid definitions (flowcharts, sequence diagrams, class diagrams, state diagrams, gantt charts, etc.). Requires 'mmdc' (mermaid-cli) to be installed: npm install -g @mermaid-js/mermaid-cli`,
  parameters: z.object({
    input: z.string().describe("Mermaid markup code OR path to a .mmd file"),
    output: z.string().describe("Output file path (e.g., 'docs/diagrams/flow.svg')"),
    format: z.enum(["svg", "png", "pdf"]).optional().default("svg").describe("Output format"),
    theme: z.enum(["default", "dark", "forest", "neutral"]).optional().describe("Mermaid theme"),
    width: z.number().optional().describe("Output width in pixels"),
    height: z.number().optional().describe("Output height in pixels"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "bash",
      patterns: ["mmdc *"],
      always: ["mmdc *"],
    })

    const dir = path.dirname(params.output)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let inputFile = params.input
    let tempFile: string | null = null

    // If input looks like inline Mermaid code
    if (params.input.includes("graph ") || params.input.includes("sequenceDiagram") ||
        params.input.includes("classDiagram") || params.input.includes("stateDiagram") ||
        params.input.includes("gantt") || params.input.includes("flowchart") ||
        params.input.includes("erDiagram") || params.input.includes("pie")) {
      tempFile = path.join(dir, `.devbunker-mmd-temp-${Date.now()}.mmd`)
      fs.writeFileSync(tempFile, params.input, "utf-8")
      inputFile = tempFile
    }

    try {
      const args = ["-i", inputFile, "-o", params.output]
      if (params.theme) args.push("-t", params.theme)
      if (params.width) args.push("-w", String(params.width))
      if (params.height) args.push("-H", String(params.height))

      const result = execSync(`mmdc ${args.join(" ")}`, {
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
          title: "Mermaid CLI not installed",
          metadata: { error: true },
          output: "Error: 'mmdc' (mermaid-cli) not found. Install it:\n\nnpm install -g @mermaid-js/mermaid-cli",
        }
      }
      return {
        title: "Mermaid error",
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
