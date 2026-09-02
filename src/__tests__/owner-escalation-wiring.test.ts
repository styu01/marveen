import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Kanban cf12a93a (2026-09-02), Istvan's standing rule (restated a second
// time): the system's own internal alerts about a SUB-AGENT or fleet-
// infrastructure problem go to BÉLA first (escalateToOwner), Istvan only if
// unresolved. stuck-input-watcher.ts (the site BÉLA originally flagged) has
// its own dedicated test file (stuck-input-owner-alert-busy-gate.test.ts);
// this file locks the wiring for every OTHER sibling site found by the
// full-codebase sweep this card asked for (channel-monitor.ts,
// agent-process.ts, agent-worker.ts), plus confirms each BÉLA-only-session
// exemption (MAIN_CHANNELS_SESSION, the main inbox drain, the main stuck-
// tool-call watcher, channel-coordinator's own fatal exit) deliberately
// still calls sendAlert/notify directly -- so a future edit that
// accidentally routes BÉLA's OWN session through escalateToOwner (which
// would strand the notice behind the very problem it reports) fails this
// file too, not just the "did we add the new mechanism" half.

const ROOT = join(__dirname, '..', '..')
function src(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

describe('channel-monitor.ts: sub-agent alert sites route through escalateToOwner', () => {
  const SRC = src('src/web/channel-monitor.ts')

  it('imports escalateToOwner and clearOwnerEscalation from owner-escalation.js', () => {
    expect(SRC).toMatch(/import\s*\{\s*escalateToOwner,\s*clearOwnerEscalation\s*\}\s*from\s*'\.\/owner-escalation\.js'/)
  })

  it('maybeAlertStuckSubAgent (the sibling to stuck-input-watcher.ts) uses escalateToOwner, not a raw sendAlert', () => {
    const start = SRC.indexOf('function maybeAlertStuckSubAgent(')
    expect(start).toBeGreaterThan(0)
    const body = SRC.slice(start, SRC.indexOf('\n}', start))
    expect(body).toMatch(/escalateToOwner\(/)
    expect(body).not.toMatch(/[^.]sendAlert\(/)
  })

  it('the alertOwnerOrBela helper exists and is isMarveen-conditional (main stays direct, subs escalate)', () => {
    const start = SRC.indexOf('function alertOwnerOrBela(')
    expect(start).toBeGreaterThan(0)
    const body = SRC.slice(start, SRC.indexOf('\n}', start))
    expect(body).toMatch(/if\s*\(t\.isMarveen\)/)
    expect(body).toMatch(/sendAlert\(ownerText\)/)
    expect(body).toMatch(/escalateToOwner\(/)
  })

  it('all six isMarveen-shared loop sites (thinking-block, login, first-run, model-consent, blocking-menu) call alertOwnerOrBela, not a raw sendAlert', () => {
    const escalationTypes = [
      'thinking-block-error',
      'login-needed', // appears twice (raw login gate + post-first-run login)
      'first-run-advanced',
      'model-consent-dialog',
      'blocking-menu-escape',
    ]
    for (const t of escalationTypes) {
      expect(SRC).toMatch(new RegExp(`alertOwnerOrBela\\(t, '${t}'`))
    }
    // login-needed is used twice (raw gate + post-answerFirstRunGates)
    expect(SRC.match(/alertOwnerOrBela\(t, 'login-needed'/g)?.length).toBe(2)
  })

  it('the two channel-down sites (busy-defer, max-restarts) use DISTINCT escalation keys, not a shared one', () => {
    expect(SRC).toMatch(/function channelDownBusyEscalationKey/)
    expect(SRC).toMatch(/function channelDownMaxRestartsEscalationKey/)
    expect(SRC).toMatch(/key:\s*channelDownBusyEscalationKey\(t\.session\)/)
    expect(SRC).toMatch(/key:\s*channelDownMaxRestartsEscalationKey\(t\.session\)/)
  })

  it('recovery paths clear the escalation state (stuck-subagent, channel-down x2)', () => {
    expect(SRC).toMatch(/clearOwnerEscalation\(stuckSubAgentEscalationKey\(t\.session\)\)/)
    expect(SRC).toMatch(/clearOwnerEscalation\(channelDownBusyEscalationKey\(t\.session\)\)/)
    expect(SRC).toMatch(/clearOwnerEscalation\(channelDownMaxRestartsEscalationKey\(t\.session\)\)/)
  })
})

describe('channel-monitor.ts: BÉLA-own-session alerts deliberately stay direct (Category A, unchanged)', () => {
  const SRC = src('src/web/channel-monitor.ts')

  it('the MAIN_CHANNELS_SESSION recovery/down-cascade calls (session vanished, resume deaf, stuck-restart cap, keepalive stale, hard-restart) still call sendAlert directly', () => {
    // A representative sample of the MAIN-only cascade, anchored on the
    // MAIN_CHANNELS_SESSION template-literal reference each carries.
    const mainOnlyFragments = [
      'session eltunt -- ujrainditom',
      'resume suketen jott fel',
      'bemenete beragadt es',
      'perce nem frissült -- respawn-pane',
      'Session resume nem segitett',
      'Hard restart SEM segitett',
    ]
    for (const frag of mainOnlyFragments) {
      const idx = SRC.indexOf(frag)
      expect(idx).toBeGreaterThan(0)
      // The nearest preceding sendAlert( call (within 200 chars back) proves
      // this fragment is still delivered via the direct path, and there's no
      // closing `)` in between (which would mean a DIFFERENT, earlier call).
      const before = SRC.slice(Math.max(0, idx - 200), idx)
      const callIdx = before.lastIndexOf('sendAlert(')
      expect(callIdx).toBeGreaterThanOrEqual(0)
      expect(before.slice(callIdx)).not.toMatch(/\)/)
    }
  })
})

describe('agent-process.ts: shared-config-collision and sub-agent parked-input route through escalateToOwner', () => {
  const SRC = src('src/web/agent-process.ts')

  it('imports escalateToOwner and clearOwnerEscalation', () => {
    expect(SRC).toMatch(/import\s*\{\s*escalateToOwner,\s*clearOwnerEscalation\s*\}\s*from\s*'\.\/owner-escalation\.js'/)
  })

  it('maybeAlertSharedConfigCollision uses escalateToOwner, and resetSharedConfigCollisionAlert clears it', () => {
    const start = SRC.indexOf('function maybeAlertSharedConfigCollision(')
    expect(start).toBeGreaterThan(0)
    const body = SRC.slice(start, SRC.indexOf('\n}', start))
    expect(body).toMatch(/escalateToOwner\(/)
    expect(body).not.toMatch(/void notifyChannel\(/)

    const resetStart = SRC.indexOf('export function resetSharedConfigCollisionAlert(')
    expect(resetStart).toBeGreaterThan(0)
    const resetBody = SRC.slice(resetStart, SRC.indexOf('\n}', resetStart))
    expect(resetBody).toMatch(/clearOwnerEscalation\('shared-config-collision'\)/)
  })

  it('the sub-agent parked-input escalation (SUBAGENT_PARKED_ESCALATE_AFTER block) uses escalateToOwner, not notifyChannel', () => {
    const gateIdx = SRC.indexOf('if (fails >= SUBAGENT_PARKED_ESCALATE_AFTER)')
    expect(gateIdx).toBeGreaterThan(0)
    const nextFnEnd = SRC.indexOf('\n  clearOwnerEscalation(subagentParkedInputEscalationKey(session))', gateIdx)
    expect(nextFnEnd).toBeGreaterThan(gateIdx)
    const body = SRC.slice(gateIdx, nextFnEnd)
    expect(body).toMatch(/escalateToOwner\(/)
    expect(body).not.toMatch(/notifyChannel\(/)
  })

  it('the MAIN_CHANNELS_SESSION parked-input escalation (MAINBOXPARK816) still calls notifyChannel directly -- BÉLA cannot receive an inter-agent notice about its own stuck inbox', () => {
    const mainStart = SRC.indexOf('if (session === MAIN_CHANNELS_SESSION) {')
    expect(mainStart).toBeGreaterThan(0)
    const mainBody = SRC.slice(mainStart, SRC.indexOf('\n  }', mainStart))
    expect(mainBody).toMatch(/notifyChannel\(/)
    expect(mainBody).not.toMatch(/escalateToOwner\(/)
  })
})

describe('agent-worker.ts: worker-stuck alert routes through escalateToOwner', () => {
  const SRC = src('src/web/agent-worker.ts')

  it('alertWorkerStuck uses escalateToOwner, not notifyChannel', () => {
    const start = SRC.indexOf('function alertWorkerStuck(')
    expect(start).toBeGreaterThan(0)
    const body = SRC.slice(start, SRC.indexOf('\n}', start))
    expect(body).toMatch(/escalateToOwner\(/)
    expect(body).not.toMatch(/notifyChannel\(/)
  })
})

describe('deliberately unchanged: BÉLA-own-session/inbox watchers stay direct (documented exemptions, not oversights)', () => {
  it('inbox-nudge-watcher.ts (MAIN agent inbox drain) still calls sendAlert directly', () => {
    const SRC = src('src/web/inbox-nudge-watcher.ts')
    expect(SRC).toMatch(/getPendingMessages\(MAIN_AGENT_ID\)/)
    expect(SRC).toMatch(/sendAlert\(/)
    expect(SRC).not.toMatch(/escalateToOwner/)
  })

  it('stuck-tool-call-watcher.ts (MAIN channels session only, per its own comment) still calls sendAlert directly', () => {
    const SRC = src('src/web/stuck-tool-call-watcher.ts')
    expect(SRC).toMatch(/checkSession\('main', MAIN_CHANNELS_SESSION\)/)
    expect(SRC).toMatch(/sendAlert\(/)
    expect(SRC).not.toMatch(/escalateToOwner/)
  })

  it('channel-coordinator.ts (fatal exit of the inbound backfill pipeline) still calls its own sendAlert directly', () => {
    const SRC = src('src/channel-coordinator.ts')
    expect(SRC).toMatch(/function sendAlert\(/)
    expect(SRC).toMatch(/FATAL/)
    expect(SRC).not.toMatch(/escalateToOwner/)
  })
})

// Codex review round 2 (2026-09-02), point D: with 12 distinct hand-written
// key-prefix literals across 4 files, verify by construction that none of
// them collide -- a collision would let one alert type's escalation state
// (and pending stage-2 timer) be silently overwritten/read by an unrelated
// alert type on the same session, corrupting both. Each site's key is
// `${literal-prefix}:${session}` (or, for the one global fleet-level alert,
// a bare literal with no session suffix) -- since the session suffix is
// identical whenever two DIFFERENT alert types fire for the SAME session,
// uniqueness reduces to the prefixes themselves being pairwise distinct,
// which this test verifies directly against the actual source rather than
// trusting the author's own bookkeeping.
describe('escalation key collision check: all 12 known key prefixes are pairwise distinct', () => {
  it('every prefix literal is present in its owning file, and the full set has no duplicates', () => {
    const cm = src('src/web/channel-monitor.ts')
    const ap = src('src/web/agent-process.ts')
    const aw = src('src/web/agent-worker.ts')
    const siw = src('src/web/stuck-input-watcher.ts')

    const prefixes = [
      // stuck-input-watcher.ts
      'stuck-input:',
      // channel-monitor.ts
      'stuck-subagent-overdue:',
      'channel-down-busy:',
      'channel-down-max-restarts:',
      // channel-monitor.ts, via alertOwnerOrBela's escalationType arg
      "'thinking-block-error'",
      "'login-needed'",
      "'first-run-advanced'",
      "'model-consent-dialog'",
      "'blocking-menu-escape'",
      // agent-process.ts
      "'shared-config-collision'",
      'subagent-parked-input:',
      // agent-worker.ts
      'worker-stuck:',
    ]
    // Pairwise-distinct as literal strings (the actual uniqueness property).
    expect(new Set(prefixes).size).toBe(prefixes.length)

    // And each one is genuinely present where claimed, not just asserted here.
    expect(siw).toMatch(/`stuck-input:\$\{session\}`/)
    expect(cm).toMatch(/`stuck-subagent-overdue:\$\{session\}`/)
    expect(cm).toMatch(/`channel-down-busy:\$\{session\}`/)
    expect(cm).toMatch(/`channel-down-max-restarts:\$\{session\}`/)
    expect(cm).toMatch(/alertOwnerOrBela\(t, 'thinking-block-error'/)
    expect(cm).toMatch(/alertOwnerOrBela\(t, 'login-needed'/)
    expect(cm).toMatch(/alertOwnerOrBela\(t, 'first-run-advanced'/)
    expect(cm).toMatch(/alertOwnerOrBela\(t, 'model-consent-dialog'/)
    expect(cm).toMatch(/alertOwnerOrBela\(t, 'blocking-menu-escape'/)
    expect(ap).toMatch(/key:\s*'shared-config-collision'/)
    expect(ap).toMatch(/`subagent-parked-input:\$\{session\}`/)
    expect(aw).toMatch(/`worker-stuck:\$\{ctx\.session\}`/)
  })
})
