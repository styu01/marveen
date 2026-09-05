import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// USAGETRACK904 (2026-09-04): startContextRestartGateRunner() enumerated its
// sweep set with listAgentNames() (dashboard-VISIBLE agents only), the exact
// same mistake context-guard-runner.ts's guardSweepAgentNames() was already
// fixed for after the 2026-08-04 agents/heartbeat incident (see
// context-guard-hidden-worker.test.ts) -- a dashboard-hidden technical worker
// (HIDDEN_AGENT_SENTINEL) would silently lose the soft /clear gate the moment
// it was hidden, store/context-restart-gate.json entry notwithstanding.
//
// No agent carries the sentinel today (usage-tracker, the agent that surfaced
// this, is NOT hidden), so this was a latent regression risk rather than a
// live outage -- caught by cross-checking this runner against its sibling's
// already-documented fix, not by reproducing a failure.
//
// context-restart-gate-runner.ts does not expose an equivalent pure
// `gateSweepAgentNames()` the way context-guard-runner.ts does (the agent
// list is built inline inside startContextRestartGateRunner(), a
// side-effecting function that arms setTimeout chains and is not meant to be
// invoked from a test). A structural source lock is the correct tool here,
// mirroring the EFFORT806-B call-site locks elsewhere in this suite: assert
// the runner's sweep-enumeration line names listAllAgentNames(), not
// listAgentNames(), and that the (still-imported, still valid for other
// call sites) listAgentNames identifier is not the one feeding the sweep.
describe('context-restart-gate sweep includes dashboard-hidden workers', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'context-restart-gate-runner.ts'),
    'utf8',
  )

  it('startContextRestartGateRunner enumerates listAllAgentNames(), not listAgentNames()', () => {
    // Check the actual CODE line, not the explanatory comment above it (which
    // legitimately names both identifiers in prose) -- strip comment-only
    // lines first so the assertion cannot pass or fail on its own docstring.
    const fn = /export function startContextRestartGateRunner\(\)[^{]*\{/.exec(src)
    expect(fn, 'startContextRestartGateRunner not found').not.toBeNull()
    let depth = 0
    let end = src.length
    for (let i = src.indexOf('{', fn!.index); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) { end = i; break }
    }
    const body = src.slice(fn!.index, end + 1)
    const codeOnly = body
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(codeOnly).toContain('listAllAgentNames()')
    expect(codeOnly).not.toMatch(/\blistAgentNames\(\)/)
  })

  it('imports listAllAgentNames from agent-config.js', () => {
    expect(src).toMatch(/import\s*\{[^}]*\blistAllAgentNames\b[^}]*\}\s*from\s*'\.\/agent-config\.js'/)
  })
})
