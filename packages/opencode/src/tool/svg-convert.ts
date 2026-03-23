import z from "zod"
import { Tool } from "./tool"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

export const SvgConvertTool = Tool.define("svg_convert", {
  description: `Convert SVG files to raster formats (PNG) and platform icon formats (ICO for Windows, ICNS for macOS). Useful for generating app icons at multiple sizes, favicons, or raster assets from SVG sources. Requires 'resvg' binary for PNG conversion. For ICNS: uses 'iconutil' on macOS (built-in). For ICO: uses 'magick' (ImageMagick) if available.`,
  parameters: z.object({
    input: z.string().describe("Input SVG file path"),
    output: z.string().describe("Output file path (e.g., 'assets/icon-64.png')"),
    format: z.enum(["png", "icns", "ico"]).optional().default("png").describe("Output format: png (default), icns (macOS app icon), ico (Windows icon)"),
    width: z.number().optional().describe("Output width in pixels (for single PNG)"),
    height: z.number().optional().describe("Output height in pixels (for single PNG)"),
    sizes: z.array(z.number()).optional().describe("Generate multiple sizes (e.g., [16, 32, 64, 128, 256, 512]). For PNG: appends size to filename. For icns/ico: bundles all sizes."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "bash",
      patterns: ["resvg *"],
      always: ["resvg *"],
    })

    if (!fs.existsSync(params.input)) {
      return {
        title: "File not found",
        metadata: { error: true },
        output: `Error: SVG file not found: ${params.input}`,
      }
    }

    const dir = path.dirname(params.output)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const format = params.format || "png"

    try {
      const generated: string[] = []

      if (format === "icns") {
        // macOS .icns generation via iconutil
        const icnsSizes = params.sizes || [16, 32, 64, 128, 256, 512, 1024]
        const iconsetDir = params.output.replace(/\.icns$/, ".iconset")
        fs.mkdirSync(iconsetDir, { recursive: true })

        for (const size of icnsSizes) {
          const pngFile = path.join(iconsetDir, `icon_${size}x${size}.png`)
          execSync(`resvg ${params.input} ${pngFile} -w ${size} -h ${size}`, {
            encoding: "utf-8",
            timeout: 15000,
          })
          // Also generate @2x variants for Retina (half the listed size)
          if (size <= 512) {
            const retinaFile = path.join(iconsetDir, `icon_${size / 2}x${size / 2}@2x.png`)
            if (size / 2 >= 16) {
              execSync(`resvg ${params.input} ${retinaFile} -w ${size} -h ${size}`, {
                encoding: "utf-8",
                timeout: 15000,
              })
            }
          }
        }

        // iconutil is macOS-only
        try {
          execSync(`iconutil -c icns ${iconsetDir} -o ${params.output}`, {
            encoding: "utf-8",
            timeout: 30000,
          })
          // Clean up iconset directory
          fs.rmSync(iconsetDir, { recursive: true, force: true })
          generated.push(params.output)
        } catch {
          // Not on macOS — keep the iconset folder as fallback
          generated.push(iconsetDir + " (iconset folder — run 'iconutil -c icns' on macOS to finalize)")
        }

      } else if (format === "ico") {
        // Windows .ico generation via ImageMagick
        const icoSizes = params.sizes || [16, 24, 32, 48, 64, 128, 256]
        const tempPngs: string[] = []

        for (const size of icoSizes) {
          const pngFile = path.join(dir, `.devbunker-ico-${size}.png`)
          execSync(`resvg ${params.input} ${pngFile} -w ${size} -h ${size}`, {
            encoding: "utf-8",
            timeout: 15000,
          })
          tempPngs.push(pngFile)
        }

        try {
          // ImageMagick convert
          execSync(`magick ${tempPngs.join(" ")} ${params.output}`, {
            encoding: "utf-8",
            timeout: 30000,
          })
          generated.push(params.output)
        } catch {
          // Fallback: keep individual PNGs
          const ext = path.extname(params.output)
          const base = params.output.slice(0, -ext.length)
          for (let i = 0; i < tempPngs.length; i++) {
            const dest = `${base}-${icoSizes[i]}.png`
            fs.renameSync(tempPngs[i], dest)
            generated.push(dest)
          }
          generated.push("(ImageMagick 'magick' not found — PNGs generated instead. Combine manually into .ico)")
        }

        // Clean up temp files
        for (const tmp of tempPngs) {
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
        }

      } else if (params.sizes && params.sizes.length > 0) {
        // Multiple PNG sizes
        const ext = path.extname(params.output)
        const base = params.output.slice(0, -ext.length)

        for (const size of params.sizes) {
          const outFile = `${base}-${size}${ext}`
          execSync(`resvg ${params.input} ${outFile} -w ${size} -h ${size}`, {
            encoding: "utf-8",
            timeout: 15000,
          })
          generated.push(outFile)
        }
      } else {
        // Single PNG output
        const args = [params.input, params.output]
        if (params.width) args.push("-w", String(params.width))
        if (params.height) args.push("-h", String(params.height))

        execSync(`resvg ${args.join(" ")}`, {
          encoding: "utf-8",
          timeout: 15000,
        })
        generated.push(params.output)
      }

      return {
        title: `Converted ${generated.length} file(s) to ${format.toUpperCase()}`,
        metadata: { files: generated, format },
        output: `Generated:\n${generated.map((f) => `  - ${f}`).join("\n")}`,
      }
    } catch (e: any) {
      const msg = e.stderr || e.message || String(e)
      if (msg.includes("not found") || msg.includes("not recognized")) {
        return {
          title: "resvg not installed",
          metadata: { error: true },
          output: "Error: 'resvg' not found. Install it:\n\ncargo install resvg\nOr download from https://github.com/RazrFalcon/resvg/releases",
        }
      }
      return {
        title: "Conversion error",
        metadata: { error: true },
        output: `Error converting SVG: ${msg}`,
      }
    }
  },
})
