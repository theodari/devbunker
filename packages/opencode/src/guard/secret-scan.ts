import { Log } from "../util/log"
import { GuardLog } from "./guard-log"

export namespace SecretScan {
  const log = Log.create({ service: "guard:secret" })

  export interface Finding {
    type: string
    pattern: string
    line: number
    match: string
    file?: string
  }

  const PATTERNS: Array<{ type: string; regex: RegExp }> = [
    // Cloud provider keys
    { type: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
    { type: "AWS Secret Key", regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/ },
    { type: "GitHub Token", regex: /ghp_[a-zA-Z0-9]{36}/ },
    { type: "GitHub OAuth", regex: /gho_[a-zA-Z0-9]{36}/ },
    { type: "GitHub App Token", regex: /(?:ghu|ghs)_[a-zA-Z0-9]{36}/ },
    { type: "GitLab Token", regex: /glpat-[a-zA-Z0-9\-]{20,}/ },
    { type: "Slack Token", regex: /xox[bpors]-[a-zA-Z0-9\-]{10,}/ },
    { type: "Slack Webhook", regex: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[a-zA-Z0-9]+/ },
    { type: "OpenAI Key", regex: /sk-[a-zA-Z0-9]{20,}/ },
    { type: "Anthropic Key", regex: /sk-ant-[a-zA-Z0-9\-]{20,}/ },
    { type: "Stripe Live Key", regex: /sk_live_[a-zA-Z0-9]{24,}/ },
    { type: "Stripe Test Key", regex: /sk_test_[a-zA-Z0-9]{24,}/ },
    { type: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/ },
    { type: "Twilio Key", regex: /SK[0-9a-fA-F]{32}/ },
    { type: "SendGrid Key", regex: /SG\.[a-zA-Z0-9\-_]{22}\.[a-zA-Z0-9\-_]{43}/ },
    { type: "Heroku API Key", regex: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/ },
    { type: "npm Token", regex: /npm_[a-zA-Z0-9]{36}/ },

    // Generic secrets
    { type: "Private Key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
    { type: "JWT Token", regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/ },
    { type: "Password in URL", regex: /:\/\/[^:]+:[^@\s]{3,}@/ },
    { type: "Generic Secret", regex: /(?:password|secret|token|apikey|api_key|access_key)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  ]

  /**
   * Scan text content for secrets.
   * Returns list of findings.
   */
  export function scan(content: string, filename?: string): Finding[] {
    const findings: Finding[] = []
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Skip comments and obvious non-secret lines
      if (isCommentOrDoc(line)) continue

      for (const { type, regex } of PATTERNS) {
        const match = line.match(regex)
        if (match) {
          // Mask the actual secret for logging
          const masked = match[0].substring(0, 8) + "..." + match[0].substring(match[0].length - 4)
          findings.push({
            type,
            pattern: regex.source,
            line: i + 1,
            match: masked,
            file: filename,
          })
        }
      }
    }

    if (findings.length > 0) {
      log.warn("secrets detected", {
        count: findings.length,
        types: [...new Set(findings.map((f) => f.type))],
        file: filename,
      })
      GuardLog.write({
        guard: "secret",
        decision: "block",
        target: filename || "unknown",
        reason: `Found ${findings.length} potential secrets`,
        details: { patterns: findings.map((f) => f.pattern) },
      })
    }

    return findings
  }

  /**
   * Scan a git diff for secrets.
   * Only checks added lines (lines starting with +).
   */
  export function scanDiff(diff: string): Finding[] {
    const findings: Finding[] = []
    let currentFile: string | undefined
    const lines = diff.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Track current file
      if (line.startsWith("+++ b/")) {
        currentFile = line.substring(6)
        continue
      }

      // Only scan added lines
      if (!line.startsWith("+") || line.startsWith("+++")) continue

      const content = line.substring(1) // Remove the + prefix
      if (isCommentOrDoc(content)) continue

      for (const { type, regex } of PATTERNS) {
        const match = content.match(regex)
        if (match) {
          const masked = match[0].substring(0, 8) + "..." + match[0].substring(match[0].length - 4)
          findings.push({
            type,
            pattern: regex.source,
            line: i + 1,
            match: masked,
            file: currentFile,
          })
        }
      }
    }

    if (findings.length > 0) {
      log.warn("secrets in diff", {
        count: findings.length,
        types: [...new Set(findings.map((f) => f.type))],
      })
      GuardLog.write({
        guard: "secret",
        decision: "block",
        target: "git-diff",
        reason: `Found ${findings.length} potential secrets in diff`,
        details: { patterns: findings.map((f) => f.pattern) },
      })
    }

    return findings
  }

  function isCommentOrDoc(line: string): boolean {
    const trimmed = line.trim()
    return (
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("<!--") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("///") ||
      trimmed.length === 0
    )
  }

  /**
   * Format findings into a human-readable message.
   */
  export function formatFindings(findings: Finding[]): string {
    if (findings.length === 0) return ""

    const lines = [`[DevBunker] ${findings.length} potential secret(s) detected:\n`]
    for (const f of findings) {
      const location = f.file ? `${f.file}:${f.line}` : `line ${f.line}`
      lines.push(`  - ${f.type} at ${location}: ${f.match}`)
    }
    lines.push("\nPush blocked. Remove secrets before pushing.")
    return lines.join("\n")
  }
}
