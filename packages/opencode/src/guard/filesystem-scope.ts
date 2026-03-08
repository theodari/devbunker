import path from "path"
import fs from "fs"
import { Log } from "../util/log"
import { Instance } from "../project/instance"

export namespace FilesystemGuard {
  const log = Log.create({ service: "guard:fs" })

  /** File patterns that are always blocked (even inside workspace) */
  const BLOCKED_PATTERNS = [
    /(?:^|\/)id_rsa$/,
    /(?:^|\/)id_ed25519$/,
    /(?:^|\/)id_ecdsa$/,
    /(?:^|\/)id_dsa$/,
    /(?:^|\/)\.ssh\/(?!config$)/,
  ]

  /** File patterns that trigger a warning (but are allowed) */
  const WARN_PATTERNS = [
    /(?:^|\/)\.env(?:\..+)?$/,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
    /\.jks$/,
    /(?:^|\/)credentials\.json$/,
    /(?:^|\/)service[-_]?account.*\.json$/,
  ]

  /** Directories that are always blocked */
  const BLOCKED_DIRS = [
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".config/gcloud",
  ]

  export type CheckResult = {
    allowed: boolean
    warn: boolean
    reason?: string
  }

  /**
   * Check if a file path is allowed for access.
   * Returns { allowed, warn, reason }
   */
  export function check(filepath: string): CheckResult {
    const resolved = resolveAndNormalize(filepath)

    // Check if path is within workspace
    if (!Instance.containsPath(resolved)) {
      const reason = `Path outside workspace: ${resolved}`
      log.warn("BLOCK", { filepath: resolved, reason })
      return { allowed: false, warn: false, reason }
    }

    // Check for symlink escape
    try {
      const real = fs.realpathSync(resolved)
      if (!Instance.containsPath(real)) {
        const reason = `Symlink escapes workspace: ${resolved} -> ${real}`
        log.warn("BLOCK", { filepath: resolved, real, reason })
        return { allowed: false, warn: false, reason }
      }
    } catch {
      // File doesn't exist yet (write), that's ok
    }

    // Check blocked directories
    for (const dir of BLOCKED_DIRS) {
      if (resolved.includes(`/${dir}/`) || resolved.includes(`\\${dir}\\`)) {
        const reason = `Access to ${dir}/ is blocked`
        log.warn("BLOCK", { filepath: resolved, reason })
        return { allowed: false, warn: false, reason }
      }
    }

    // Check blocked file patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(resolved)) {
        const reason = `File is blocked: matches ${pattern.source}`
        log.warn("BLOCK", { filepath: resolved, reason })
        return { allowed: false, warn: false, reason }
      }
    }

    // Check warn patterns
    for (const pattern of WARN_PATTERNS) {
      if (pattern.test(resolved)) {
        log.info("WARN", { filepath: resolved, pattern: pattern.source })
        return {
          allowed: true,
          warn: true,
          reason: `Sensitive file detected: ${path.basename(resolved)}`,
        }
      }
    }

    log.info("ALLOW", { filepath: resolved })
    return { allowed: true, warn: false }
  }

  /**
   * Assert that a filepath is allowed. Throws if blocked.
   */
  export function assert(filepath: string): void {
    const result = check(filepath)
    if (!result.allowed) {
      throw new Error(`[DevBunker Guard] ${result.reason}`)
    }
  }

  function resolveAndNormalize(filepath: string): string {
    if (!path.isAbsolute(filepath)) {
      return path.resolve(Instance.directory, filepath)
    }
    return path.normalize(filepath)
  }
}
