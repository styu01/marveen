import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripUnsafeStatusLine, shouldStripStatusLine, STATUSLINE_ALLOWED_AGENTS } from '../web/agent-process.js'

// stripUnsafeStatusLine is the technical enforcement half of the statusLine
// usage-tracker safety conclusion (docs/statusline-usage-tracker-dev-spec-
// 20260901.md section 4/8): a fleet-managed sub-agent session must NEVER
// carry `statusLine`, because it suppresses the `esc to interrupt` footer
// hint pane-state.ts's busy detector depends on. This is the guard that
// runs at every sub-agent launch (see the call site in agent-process.ts,
// right after the enabledPlugins scoping).
describe('stripUnsafeStatusLine', () => {
  it('removes statusLine and its companion refreshInterval when present', () => {
    const { settings, removed } = stripUnsafeStatusLine({
      model: 'claude-sonnet-5',
      statusLine: { type: 'command', command: '/x/y.py' },
      refreshInterval: 60,
      enabledPlugins: { telegram: true },
    })
    expect(removed).toBe(true)
    expect(settings).not.toHaveProperty('statusLine')
    expect(settings).not.toHaveProperty('refreshInterval')
    expect(settings.model).toBe('claude-sonnet-5')
    expect(settings.enabledPlugins).toEqual({ telegram: true })
  })

  it('removes statusLine even without a refreshInterval present', () => {
    const { settings, removed } = stripUnsafeStatusLine({
      statusLine: { type: 'command', command: '/x/y.py' },
    })
    expect(removed).toBe(true)
    expect(settings).not.toHaveProperty('statusLine')
  })

  it('is a no-op (same reference, removed=false) when statusLine is absent', () => {
    const input = { model: 'claude-sonnet-5', enabledPlugins: { telegram: true } }
    const { settings, removed } = stripUnsafeStatusLine(input)
    expect(removed).toBe(false)
    expect(settings).toBe(input) // literally the same object, no needless copy/churn
  })

  it('does not mutate the input object when removing', () => {
    const input: Record<string, unknown> = { statusLine: { type: 'command', command: '/x' } }
    const { settings } = stripUnsafeStatusLine(input)
    expect(input).toHaveProperty('statusLine') // original untouched
    expect(settings).not.toBe(input)
  })
})

describe('stripUnsafeStatusLine is actually wired into the sub-agent launch path', () => {
  const SRC = readFileSync(join(__dirname, '../web/agent-process.ts'), 'utf-8')

  it('the per-agent settings.json write goes through stripUnsafeStatusLine before writeFileSync', () => {
    const scopeIdx = SRC.indexOf('s.enabledPlugins = scopeChannelPlugins(')
    const stripIdx = SRC.indexOf('stripUnsafeStatusLine(s)')
    const writeIdx = SRC.indexOf('writeFileSync(settingsPath, JSON.stringify(sClean, null, 2))')
    expect(scopeIdx).toBeGreaterThan(0)
    expect(stripIdx).toBeGreaterThan(scopeIdx)
    expect(writeIdx).toBeGreaterThan(stripIdx)
  })

  it('the strip call is gated by shouldStripStatusLine(name), not unconditional', () => {
    const stripIdx = SRC.indexOf('stripUnsafeStatusLine(s)')
    const gateIdx = SRC.indexOf('if (shouldStripStatusLine(name))')
    expect(gateIdx).toBeGreaterThan(0)
    expect(stripIdx).toBeGreaterThan(gateIdx)
  })
})

// Kanban 80f29abb: the ONE designated exception, added when the usage-
// tracker agent's actual first launch was blocked by the unconditional
// scrub above. See STATUSLINE_ALLOWED_AGENTS's own header comment for why
// this is a hardcoded, code-reviewed allowlist rather than a per-agent
// config field.
describe('shouldStripStatusLine / STATUSLINE_ALLOWED_AGENTS', () => {
  it('the designated usage-tracker agent is exempt', () => {
    expect(shouldStripStatusLine('usage-tracker')).toBe(false)
  })

  it('every fleet-managed sub-agent (progi/okoska/iris/vizsla) is still stripped', () => {
    for (const name of ['progi', 'okoska', 'iris', 'vizsla']) {
      expect(shouldStripStatusLine(name)).toBe(true)
    }
  })

  it('an arbitrary/unknown agent name defaults to stripped (fail safe, not fail open)', () => {
    expect(shouldStripStatusLine('some-future-agent')).toBe(true)
  })

  it('STATUSLINE_ALLOWED_AGENTS contains exactly the designated tracker agent, nothing else', () => {
    expect(Array.from(STATUSLINE_ALLOWED_AGENTS)).toEqual(['usage-tracker'])
  })
})
