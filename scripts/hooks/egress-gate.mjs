#!/usr/bin/env node
// PreToolUse hook: WebFetch egress allowlist enforcement.
//
// Any WebFetch call from the main agent must target a known, legitimate API
// endpoint. Arbitrary web content (RSS feeds, docs, news pages, public APIs
// not in the allowlist) MUST go through the quarantine-reader sub-agent
// instead, so the fetched content is quarantined, wrapped, and never executed
// as instructions in the main agent's context.
//
// Two-tier allowlist:
//   1. Built-in (ALLOWED_PREFIXES): hard-coded, always enforced.
//   2. Runtime (store/egress-allowlist.json): operator-managed, loaded on each
//      invocation. Shape: { "domains": ["example.com"], "prefixes": ["https://host/path/"] }
//      Both keys are optional. Missing file or malformed JSON -> treated as empty
//      lists (FAIL-OPEN on the file, FAIL-SAFE on the decision: the built-in list
//      still guards; no extra URLs are allowed merely because the file is missing).
//
// When a URL is not on either allowlist:
//   - The tool call is HARD-BLOCKED (decision: deny).
//   - The blocked call is appended to EGRESS_BLOCK_LOG for operator review.
//   - The operator can approve the URL/domain: add it to store/egress-allowlist.json,
//     then re-run the WebFetch. No restart required.
//
// The log is separate from the main Marveen log so operators can grep it
// independently: `tail -f store/egress-blocked.log`
//
// Scope: this guard covers the Claude Code WebFetch tool only. It does NOT
// intercept WebSearch, curl/Bash network calls, or MCP-server outbound
// requests. Those channels are out of scope for this hook mechanism and require
// separate controls if needed.

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isIP } from 'node:net'

// The Task/Agent-tool sub-agent whose WebFetch calls carry this exact
// `agent_type` in the PreToolUse payload. Claude Code sets the field from the
// spawned subagent_type -- it is NOT settable from agent/prompt/web content, so
// it cannot be spoofed by prompt injection reaching a main agent. Only this
// sub-agent (WebFetch-only, quarantined output) gets the widened Tier-2 rule.
const QUARANTINE_READER_AGENT_TYPE = 'quarantine-reader'

// Derive repo root from this script's location (scripts/hooks/egress-gate.mjs).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EGRESS_BLOCK_LOG = join(REPO_ROOT, 'store', 'egress-blocked.log')
const RUNTIME_ALLOWLIST_PATH = join(REPO_ROOT, 'store', 'egress-allowlist.json')

// Dashboard port: env WEB_PORT, else the install .env, else the 3420 default.
// A fixed 3420 in the allowlist below blocked the agent's own dashboard as soon
// as the install moved to another port.
const DASHBOARD_PORT = (() => {
  if (process.env['WEB_PORT']) return process.env['WEB_PORT']
  try {
    const m = readFileSync(join(REPO_ROOT, '.env'), 'utf-8').match(/^WEB_PORT=(.*)$/m)
    const v = m?.[1]?.trim().replace(/^["']|["']$/g, '')
    if (v) return v
  } catch { /* no .env: fall through to the default */ }
  return '3420'
})()

// Built-in allowlist: URL prefixes the main agent may call directly via WebFetch.
// Anything not on this list (or the runtime allowlist) must go through the
// quarantine-reader sub-agent. Keep sorted and documented so additions are
// intentional, not accidental.
const ALLOWED_PREFIXES = [
  // GitHub REST API
  'https://api.github.com/',
  // Google OAuth token endpoint
  'https://oauth2.googleapis.com/',
  // Google APIs (Calendar, Gmail, Drive, etc.)
  'https://www.googleapis.com/',
  'https://gmail.googleapis.com/',
  'https://calendar.googleapis.com/',
  // Telegram Bot API
  'https://api.telegram.org/',
  // Slack Web API
  'https://slack.com/api/',
  // Discord REST API
  'https://discord.com/api/',
  // Ollama (local LLM server) -- localhost and loopback
  'http://localhost:11434/',
  'http://127.0.0.1:11434/',
  // Marveen dashboard API (local). The port follows WEB_PORT: a fixed 3420 here
  // blocked the agent's own dashboard once the install moved to another port.
  `http://localhost:${DASHBOARD_PORT}/`,
  `http://127.0.0.1:${DASHBOARD_PORT}/`,
]

// Load the runtime allowlist from store/egress-allowlist.json.
// FAIL-OPEN on the file: missing or malformed -> empty lists, NOT an error.
// The caller must still apply the built-in ALLOWED_PREFIXES.
export function loadRuntimeAllowlist() {
  try {
    const raw = readFileSync(RUNTIME_ALLOWLIST_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      domains: Array.isArray(parsed.domains) ? parsed.domains.filter((d) => typeof d === 'string') : [],
      prefixes: Array.isArray(parsed.prefixes) ? parsed.prefixes.filter((p) => typeof p === 'string') : [],
    }
  } catch {
    // Missing file or JSON parse error: treat as empty, never propagate.
    return { domains: [], prefixes: [] }
  }
}

// Pure decision: allowed (false) or blocked (true)?
//
// `runtimeList` is the decoded store/egress-allowlist.json (or any equivalent
// object). Keeping file I/O out of this function makes it fully unit-testable
// without touching the filesystem.
//
// Domain matching uses URL-parsed hostname ONLY, not string-contains, to prevent
// bypasses like `https://evil.com/?x=docs.anthropic.com` matching the domain
// "docs.anthropic.com" via a simple includes() check.
export function isEgressBlocked(toolName, toolInput, runtimeList = { domains: [], prefixes: [] }) {
  if (toolName !== 'WebFetch') return false
  const url = String(toolInput?.url ?? '')
  if (!url) return false

  // 1. Built-in prefix check (startsWith is correct here: the prefix already
  //    includes the trailing slash so a prefix-extension attack is impossible,
  //    e.g. 'https://api.github.com.evil.com/' does not start with
  //    'https://api.github.com/').
  if (ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))) return false

  // 2. Runtime prefix check.
  const rtPrefixes = runtimeList.prefixes ?? []
  if (rtPrefixes.some((p) => url.startsWith(p))) return false

  // 3. Runtime domain check: parse the URL to extract a verified hostname.
  //    URL parsing fails on non-URLs -> block (fail-safe).
  const rtDomains = runtimeList.domains ?? []
  if (rtDomains.length > 0) {
    let hostname
    try {
      hostname = new URL(url).hostname
    } catch {
      // Unparseable URL: block, don't throw.
      return true
    }
    // Match exact hostname OR any subdomain (host.endsWith('.' + domain)).
    if (rtDomains.some((d) => hostname === d || hostname.endsWith('.' + d))) return false
  }

  return true
}

// Tier-2 rule for the quarantine-reader sub-agent ONLY: any https:// URL to a
// real domain name is allowed, but never an SSRF target. The quarantine-reader
// has only the WebFetch tool and returns wrapped, never-executed content, so
// broad READ access is safe -- but it must not become an SSRF oracle for
// internal / loopback / cloud-metadata endpoints. Blocks (returns false) unless:
//   - the scheme is https (no http/file/ftp/gopher), AND
//   - the hostname is NOT localhost, AND
//   - the hostname is NOT a bare IP literal (isIP != 0). A raw IP covers every
//     loopback/private/link-local/metadata case (127/8, 10/8, 172.16/12,
//     192.168/16, 169.254/16 incl. 169.254.169.254, 0.0.0.0, ::1) in one check,
//     and article/blog links are domain names anyway, so a raw-IP target is a
//     red flag regardless of range.
export function isQuarantineFetchAllowed(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  let host = parsed.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1) // ipv6 literal
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (isIP(host) !== 0) return false
  return true
}

// Agent-scoped gate decision. The quarantine-reader sub-agent (identified by the
// runtime-set agent_type, see QUARANTINE_READER_AGENT_TYPE) gets the widened
// Tier-2 rule; every other caller -- main agents and their own direct WebFetch,
// any other sub-agent -- stays on the narrow built-in + runtime allowlist. An
// absent or unrecognised agent_type falls through to the narrow path (fail-safe).
export function shouldBlockWebFetch(payload, runtimeList = { domains: [], prefixes: [] }) {
  if (payload?.tool_name !== 'WebFetch') return false
  if (payload?.agent_type === QUARANTINE_READER_AGENT_TYPE) {
    return !isQuarantineFetchAllowed(payload?.tool_input?.url ?? '')
  }
  return isEgressBlocked(payload?.tool_name, payload?.tool_input, runtimeList)
}

function logBlocked(url, reason) {
  try {
    mkdirSync(join(REPO_ROOT, 'store'), { recursive: true })
    const ts = new Date().toISOString()
    appendFileSync(EGRESS_BLOCK_LOG, `${ts} BLOCKED url="${url}" reason="${reason}"\n`, 'utf-8')
  } catch {
    // Never let log failure cascade into blocking the agent process itself.
  }
}

const BLOCK_MESSAGE =
  'Egress TILTOTT (egress-gate hook). Ez az URL nem szerepel a fő ágens WebFetch ' +
  'engedélylistáján. Külső web-tartalom (RSS, dokumentáció, cikkek, ismeretlen API-k) ' +
  'KIZÁRÓLAG a quarantine-reader sub-ágensen keresztül kérhető le: ' +
  'Agent({ subagent_type: "quarantine-reader", prompt: `FETCH {"url":"...","nonce":"..."}` }). ' +
  'A letiltott hívás rögzítve lett a store/egress-blocked.log fájlban. ' +
  'Ha ez a hívás jogos, az operátor jóváhagyhatja: adja hozzá az URL-t vagy domain-t a ' +
  'store/egress-allowlist.json fájlhoz ({ "domains": ["example.com"] } vagy ' +
  '{ "prefixes": ["https://example.com/api/"] }), majd futtassa újra a WebFetch hívást.'

const QUARANTINE_BLOCK_MESSAGE =
  'Egress TILTOTT (egress-gate, quarantine-reader SSRF-guard). A quarantine-reader ' +
  'bármely https:// URL-t lekérhet egy valódi domain-névről, DE nem érhet el SSRF-célt: ' +
  'nem-https séma, `localhost`, vagy bármilyen nyers IP-cím (loopback/privát/link-local/' +
  'metadata, pl. 169.254.169.254) TILTOTT. A letiltott hívás rögzítve a store/egress-blocked.log-ban.'

function allow() { process.exit(0) }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }))
  process.exit(0)
}

function isInvokedDirectly() {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url))
    const entry = process.argv[1] ? realpathSync(process.argv[1]) : ''
    return self === entry
  } catch {
    return false
  }
}

if (isInvokedDirectly()) {
  let payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    allow() // malformed/empty input must never block the agent
  }
  const url = String(payload?.tool_input?.url ?? '')
  const runtimeList = loadRuntimeAllowlist()
  if (shouldBlockWebFetch(payload, runtimeList)) {
    const isQuarantine = payload?.agent_type === QUARANTINE_READER_AGENT_TYPE
    logBlocked(url, isQuarantine ? 'quarantine-reader SSRF guard (non-https or IP/localhost host)' : 'not on egress allowlist')
    deny(isQuarantine ? QUARANTINE_BLOCK_MESSAGE : BLOCK_MESSAGE)
  }
  allow()
}
