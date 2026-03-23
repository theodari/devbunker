import z from "zod"
import { Tool } from "./tool"
import * as fs from "fs"
import * as path from "path"

export const SvgGenerateTool = Tool.define("svg_generate", {
  description: `Write SVG markup to a file. Use this to create icons, logos, illustrations, and simple graphics. You generate the SVG XML code and this tool saves it. SVG is a vector format that scales perfectly at any size.`,
  parameters: z.object({
    content: z.string().describe("The SVG markup content (must be valid SVG XML)"),
    output: z.string().describe("Output file path (e.g., 'assets/icons/app-icon.svg')"),
    width: z.number().optional().describe("Viewport width (default: from SVG viewBox)"),
    height: z.number().optional().describe("Viewport height (default: from SVG viewBox)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "edit",
      patterns: [params.output],
      always: ["*"],
    })

    const dir = path.dirname(params.output)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    let svg = params.content.trim()

    // Ensure proper SVG header if not present
    if (!svg.startsWith("<?xml") && !svg.startsWith("<svg")) {
      return {
        title: "Invalid SVG",
        metadata: { error: true },
        output: "Error: Content must be valid SVG markup starting with <svg> or <?xml>",
      }
    }

    // Add xmlns if missing
    if (svg.includes("<svg") && !svg.includes("xmlns=")) {
      svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    // Set dimensions if provided
    if (params.width && !svg.includes("width=")) {
      svg = svg.replace("<svg", `<svg width="${params.width}"`)
    }
    if (params.height && !svg.includes("height=")) {
      svg = svg.replace("<svg", `<svg height="${params.height}"`)
    }

    fs.writeFileSync(params.output, svg, "utf-8")

    const sizeKB = Math.round(Buffer.byteLength(svg) / 1024 * 10) / 10

    return {
      title: `SVG created (${sizeKB} KB)`,
      metadata: { output: params.output, sizeKB },
      output: `SVG file created: ${params.output} (${sizeKB} KB)`,
    }
  },
})
