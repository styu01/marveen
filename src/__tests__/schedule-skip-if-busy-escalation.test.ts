import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  decideSkipIfBusyEscalation,
  nextSkipIfBusyStreak,
  SKIP_IF_BUSY_ESCALATE_AFTER_MS,
  SKIP_IF_BUSY_GAP_JITTER_MARGIN_MS,
  type SkipIfBusyDecision,
  type SkipIfBusyStreak,
} from '../web/schedule-runner.js'
import { ALERT_THRESHOLD_MS, OWNER_ESCALATION_EXTRA_MS } from '../pending-retries.js'

// The default gap tolerance nextSkipIfBusyStreak uses -- deliberately BELOW
// the raw escalation threshold (Codex review, 2026-09-05, BLOCKING: a `*/30`
// task could otherwise slip under an exactly-30-minute tolerance via ordinary
// scheduler tick jitter). Computed here, not hardcoded, so these tests track
// the real default instead of re-deriving it independently.
const DEFAULT_GAP_TOLERANCE_MS = SKIP_IF_BUSY_ESCALATE_AFTER_MS - SKIP_IF_BUSY_GAP_JITTER_MARGIN_MS

// Regression coverage for the 2026-09-05 (Bela) WSL-resume incident: a
// skipIfBusy heartbeat (usage-tracker-poll, */10 cron) silently dropped every
// tick for 45+ minutes because its target session was wedged busy (a turn
// started before a host sleep/resume never got a response afterward), and
// skipIfBusy's "a single missed tick is harmless" design meant NO pending-
// retry row was ever created and NO alert fired anywhere.
//
// First draft of this fix used a plain "ms since first-seen-busy" timer and
// was rejected on independent Codex review, BLOCKING, for a real gap: a task
// is only ever attempted (and so only ever OBSERVED) when its OWN cron
// matches, so for an hourly/weekly skipIfBusy task (this repo ships both --
// intel-collector, bumblebee-hygiene-scan) two observations of 'busy' far
// apart are almost certainly unrelated episodes, not one continuous wedge.
// nextSkipIfBusyStreak's gap-tolerant model (below) is the fix; these tests
// exercise the ACTUAL behavior via the real exported functions, not just
// source-scanning for the right tokens (the reviewer's other criticism of
// the first draft's test suite).

describe('decideSkipIfBusyEscalation', () => {
  it('stays silent for a brand-new busy streak (0ms elapsed)', () => {
    expect(decideSkipIfBusyEscalation(0)).toBe('skip-silently')
  })

  it('stays silent for an ordinary short busy window (e.g. an active conversation)', () => {
    expect(decideSkipIfBusyEscalation(5 * 60_000)).toBe('skip-silently')
  })

  it('stays silent one millisecond below the threshold', () => {
    expect(decideSkipIfBusyEscalation(SKIP_IF_BUSY_ESCALATE_AFTER_MS - 1)).toBe('skip-silently')
  })

  it('escalates AT exactly the threshold (inclusive boundary)', () => {
    expect(decideSkipIfBusyEscalation(SKIP_IF_BUSY_ESCALATE_AFTER_MS)).toBe('escalate')
  })

  it('escalates past the threshold', () => {
    expect(decideSkipIfBusyEscalation(SKIP_IF_BUSY_ESCALATE_AFTER_MS + 1)).toBe('escalate')
    expect(decideSkipIfBusyEscalation(SKIP_IF_BUSY_ESCALATE_AFTER_MS * 10)).toBe('escalate')
  })

  it('respects an explicit custom threshold, ignoring the default export', () => {
    expect(decideSkipIfBusyEscalation(5_000, 10_000)).toBe('skip-silently')
    expect(decideSkipIfBusyEscalation(10_000, 10_000)).toBe('escalate')
    expect(decideSkipIfBusyEscalation(15_000, 10_000)).toBe('escalate')
  })

  // Pins the actual default value -- a silent change here would silently
  // change how long a wedged skipIfBusy session can go unnoticed.
  it('the default threshold is exactly 30 minutes', () => {
    expect(SKIP_IF_BUSY_ESCALATE_AFTER_MS).toBe(30 * 60_000)
  })
})

describe('nextSkipIfBusyStreak', () => {
  it('starts a fresh streak on the first observation (no prior entry)', () => {
    expect(nextSkipIfBusyStreak(undefined, 1000)).toEqual({ startedAt: 1000, lastObservedAt: 1000 })
  })

  it('extends the streak (keeps startedAt) when the gap since the last observation is small', () => {
    const first = nextSkipIfBusyStreak(undefined, 0)
    const second = nextSkipIfBusyStreak(first, 10 * 60_000)
    expect(second).toEqual({ startedAt: 0, lastObservedAt: 10 * 60_000 })
  })

  it('extends across several small gaps in a row, preserving the original startedAt throughout', () => {
    let streak = nextSkipIfBusyStreak(undefined, 0)
    streak = nextSkipIfBusyStreak(streak, 10 * 60_000)
    streak = nextSkipIfBusyStreak(streak, 20 * 60_000)
    streak = nextSkipIfBusyStreak(streak, 29 * 60_000)
    expect(streak.startedAt).toBe(0)
    expect(streak.lastObservedAt).toBe(29 * 60_000)
  })

  it('resets the streak (fresh startedAt) when the gap meets the DEFAULT gap tolerance (margin-reduced, not the raw 30m threshold)', () => {
    const first = nextSkipIfBusyStreak(undefined, 0)
    const second = nextSkipIfBusyStreak(first, DEFAULT_GAP_TOLERANCE_MS)
    expect(second).toEqual({ startedAt: DEFAULT_GAP_TOLERANCE_MS, lastObservedAt: DEFAULT_GAP_TOLERANCE_MS })
  })

  it('pins the exact default gap-tolerance boundary: just under extends, exactly at resets', () => {
    const first = nextSkipIfBusyStreak(undefined, 0)
    expect(nextSkipIfBusyStreak(first, DEFAULT_GAP_TOLERANCE_MS - 1).startedAt).toBe(0)
    expect(nextSkipIfBusyStreak(first, DEFAULT_GAP_TOLERANCE_MS).startedAt).toBe(DEFAULT_GAP_TOLERANCE_MS)
  })

  // Codex review (2026-09-05, BLOCKING): the default gap tolerance must sit a
  // meaningful margin BELOW the raw escalation threshold, not equal to it --
  // otherwise a task whose nominal cadence sits exactly at the threshold
  // (e.g. `*/30`) could have real observed gaps land under it purely from
  // scheduler tick jitter (SCHEDULE_TICK_MS + normal delay), letting a streak
  // build when it structurally should not be able to.
  it('the default gap tolerance is exactly 5 minutes below the escalation threshold', () => {
    expect(SKIP_IF_BUSY_GAP_JITTER_MARGIN_MS).toBe(5 * 60_000)
    expect(DEFAULT_GAP_TOLERANCE_MS).toBe(25 * 60_000)
  })

  it('a gap AT the raw escalation threshold (30m) does NOT extend -- the margin is what makes this safe under jitter', () => {
    const first = nextSkipIfBusyStreak(undefined, 0)
    const second = nextSkipIfBusyStreak(first, SKIP_IF_BUSY_ESCALATE_AFTER_MS)
    expect(second.startedAt).toBe(SKIP_IF_BUSY_ESCALATE_AFTER_MS) // reset, not extended
  })

  it('respects a custom maxGapMs, independent of the escalation threshold', () => {
    const first = nextSkipIfBusyStreak(undefined, 0, 5_000)
    expect(nextSkipIfBusyStreak(first, 4_999, 5_000).startedAt).toBe(0)
    expect(nextSkipIfBusyStreak(first, 5_000, 5_000).startedAt).toBe(5_000)
  })
})

// Simulates a sequence of busy observations through the SAME two real,
// exported functions the tick loop uses, mirroring its exact fold: extend or
// reset the streak, decide, and (on escalate) clear -- exactly what
// `skipIfBusyStreaks.delete(key)` does in the escalate branch. This is
// genuine behavioral coverage, not a regex check for the right token names.
function simulateBusyObservations(observationTimesMs: number[]): SkipIfBusyDecision[] {
  let streak: SkipIfBusyStreak | undefined
  return observationTimesMs.map((t) => {
    streak = nextSkipIfBusyStreak(streak, t)
    const decision = decideSkipIfBusyEscalation(t - streak.startedAt)
    if (decision === 'escalate') streak = undefined
    return decision
  })
}

describe('skipIfBusy streak simulation (end-to-end behavioral scenarios)', () => {
  it('a */10 heartbeat escalates only on the 4th consecutive observation (~30m), not before', () => {
    const TEN_MIN = 10 * 60_000
    expect(simulateBusyObservations([0, TEN_MIN, 2 * TEN_MIN, 3 * TEN_MIN])).toEqual([
      'skip-silently', 'skip-silently', 'skip-silently', 'escalate',
    ])
  })

  it('busy -> idle -> busy: an idle observation in between resets the streak (fresh grace window)', () => {
    // Busy at 0/10/20 min builds a streak; an idle observation at 25 min
    // (mirrored here by discarding the streak, exactly what the tick loop's
    // `if (!isTrackedSkipIfBusyStreak) skipIfBusyStreaks.delete(key)` does)
    // means the NEXT busy observation (26 min) must start its OWN streak,
    // not inherit the one from before the idle gap.
    let streak: SkipIfBusyStreak | undefined = nextSkipIfBusyStreak(undefined, 0)
    streak = nextSkipIfBusyStreak(streak, 10 * 60_000)
    streak = nextSkipIfBusyStreak(streak, 20 * 60_000)
    streak = undefined // idle observed -- tick loop deletes the map entry
    streak = nextSkipIfBusyStreak(streak, 26 * 60_000)
    expect(streak.startedAt).toBe(26 * 60_000)
    expect(decideSkipIfBusyEscalation(26 * 60_000 - streak.startedAt)).toBe('skip-silently')
  })

  it('two observations 60 minutes apart with NOTHING in between do NOT read as 60 minutes of continuous busy', () => {
    // Could be an hour-long pending-retry detour on an otherwise-frequent
    // task, or simply a rare/hourly cron -- either way, a single large gap
    // must not be misread as proof of continuity across it.
    let streak = nextSkipIfBusyStreak(undefined, 0)
    streak = nextSkipIfBusyStreak(streak, 60 * 60_000)
    expect(streak.startedAt).toBe(60 * 60_000) // reset, not 0
    expect(decideSkipIfBusyEscalation(60 * 60_000 - streak.startedAt)).toBe('skip-silently')
  })

  it('an HOURLY-cadence skipIfBusy task can never escalate via this path -- an accepted, honest limitation', () => {
    // This repo ships hourly/weekly skipIfBusy tasks (intel-collector,
    // bumblebee-hygiene-scan). Every one of their observations is, by
    // construction, further apart than the gap tolerance, so each looks like
    // a fresh streak forever -- correct, because this mechanism has no way to
    // tell "wedged the whole hour" from "busy at two unrelated moments"
    // without polling independently of the task's own schedule.
    const HOUR = 60 * 60_000
    const decisions = simulateBusyObservations([0, HOUR, 2 * HOUR, 3 * HOUR, 10 * HOUR])
    expect(decisions.every((d) => d === 'skip-silently')).toBe(true)
  })

  it('escalating once does not permanently poison a later, unrelated busy episode', () => {
    const TEN_MIN = 10 * 60_000
    const decisions = simulateBusyObservations([
      0, TEN_MIN, 2 * TEN_MIN, 3 * TEN_MIN, // escalates at index 3 (~30m)
      4 * TEN_MIN, 5 * TEN_MIN, 6 * TEN_MIN, 7 * TEN_MIN, // fresh streak, escalates again at index 7
    ])
    expect(decisions[3]).toBe('escalate')
    expect(decisions.slice(4)).toEqual(['skip-silently', 'skip-silently', 'skip-silently', 'escalate'])
  })

  // Codex review (2026-09-05, BLOCKING -- and again on the FIRST version of
  // this very test, which used a sequence that would not have escalated even
  // under the OLD tolerance, so it proved nothing): a `*/30` cadence sits
  // EXACTLY at the raw escalation threshold, and this repo ships a `*/30`
  // skipIfBusy=true template -- so ordinary scheduler tick jitter
  // (SCHEDULE_TICK_MS = 15s, plus normal per-tick delay) making real observed
  // gaps land a few seconds under 30:00 must NOT be enough to build an
  // escalating streak. This test proves BOTH halves explicitly, on the exact
  // same sequence: the OLD (v2/v3) "reuse the raw 30-minute threshold as the
  // gap tolerance" model WOULD escalate on this sequence (simulated here by
  // passing SKIP_IF_BUSY_ESCALATE_AFTER_MS as an explicit maxGapMs, i.e. the
  // pre-fix default), while the actual, current default (25-minute,
  // margin-reduced tolerance) does not.
  it('a nominal */30 cadence with realistic tick jitter escalates under the OLD raw-threshold tolerance but NOT under the current margin-adjusted one', () => {
    const JITTER_MS = 7_000 // 7 seconds early -- comfortably inside one SCHEDULE_TICK_MS
    const GAP = SKIP_IF_BUSY_ESCALATE_AFTER_MS - JITTER_MS // 29:53, consistently a little early
    const observations = [0, GAP, 2 * GAP]

    // OLD behavior (pre-fix): reusing the raw threshold as the gap tolerance.
    // Simulated inline (not via simulateBusyObservations, which always uses
    // the current default) by passing the old value explicitly.
    let oldStreak: SkipIfBusyStreak | undefined
    let oldDecision: SkipIfBusyDecision = 'skip-silently'
    for (const t of observations) {
      oldStreak = nextSkipIfBusyStreak(oldStreak, t, SKIP_IF_BUSY_ESCALATE_AFTER_MS)
      oldDecision = decideSkipIfBusyEscalation(t - oldStreak.startedAt)
    }
    expect(oldDecision).toBe('escalate') // proves this sequence WOULD have been a false positive pre-fix

    // Actual, current behavior (default maxGapMs = 25 minutes) must NOT
    // escalate on the identical sequence.
    const decisions = simulateBusyObservations(observations)
    expect(decisions.every((d) => d === 'skip-silently')).toBe(true)
  })
})

// Mirrors the tick loop's exact per-key handling (isTrackedSkipIfBusyStreak,
// the Map read/fold/write, escalate-clears) using the real exported
// functions, so a config change mid-stream is exercised as ACTUAL behavior.
function tickOutcome(
  streaks: Map<string, SkipIfBusyStreak>,
  key: string,
  busy: boolean,
  skipIfBusy: boolean,
  forceSend: boolean,
  now: number,
): SkipIfBusyDecision | 'not-tracked' {
  const isTracked = busy && skipIfBusy && !forceSend
  if (!isTracked) {
    streaks.delete(key)
    return 'not-tracked'
  }
  const streak = nextSkipIfBusyStreak(streaks.get(key), now)
  streaks.set(key, streak)
  const decision = decideSkipIfBusyEscalation(now - streak.startedAt)
  if (decision === 'escalate') streaks.delete(key)
  return decision
}

describe('skipIfBusy config-change mid-streak (Codex-requested regression scenario)', () => {
  it('flipping skipIfBusy=false mid-streak clears tracking; re-enabling later starts fresh', () => {
    const streaks = new Map<string, SkipIfBusyStreak>()
    const key = 'demo-task@demo-agent'
    expect(tickOutcome(streaks, key, true, true, false, 0)).toBe('skip-silently')
    expect(tickOutcome(streaks, key, true, true, false, 10 * 60_000)).toBe('skip-silently')
    // Operator disables skipIfBusy while the session is still busy.
    expect(tickOutcome(streaks, key, true, false, false, 20 * 60_000)).toBe('not-tracked')
    expect(streaks.has(key)).toBe(false)
    // Re-enabled, still busy well past the ORIGINAL streak's would-be
    // threshold (45 min since t=0) -- must read as a FRESH streak, not an
    // already-overdue one.
    expect(tickOutcome(streaks, key, true, true, false, 45 * 60_000)).toBe('skip-silently')
  })

  it('forceSend=true mid-streak also clears tracking', () => {
    const streaks = new Map<string, SkipIfBusyStreak>()
    const key = 'demo-task@demo-agent'
    tickOutcome(streaks, key, true, true, false, 0)
    expect(tickOutcome(streaks, key, true, true, true, 5 * 60_000)).toBe('not-tracked')
    expect(streaks.has(key)).toBe(false)
  })

  it('a non-busy result mid-streak clears tracking', () => {
    const streaks = new Map<string, SkipIfBusyStreak>()
    const key = 'demo-task@demo-agent'
    tickOutcome(streaks, key, true, true, false, 0)
    expect(tickOutcome(streaks, key, false, true, false, 5 * 60_000)).toBe('not-tracked')
    expect(streaks.has(key)).toBe(false)
  })
})

// Codex review (2026-09-05, BLOCKING on the v2 draft): a key that comes under
// pending-retry pipeline ownership must have its skipIfBusy streak discarded
// UNCONDITIONALLY, not left to the gap check -- that pipeline observes the
// key on every tick (not gated by cron), so it can resolve (fire, or the task
// gets disabled) well inside the gap tolerance, and the cron loop's
// `pendingKeys.has(key)` skip means it never notices that resolution.
// registerPendingKey mirrors the real retry-registration loop's
// `skipIfBusyStreaks.delete(key)` call at the moment a key enters pendingKeys
// (schedule-runner.ts, right after `pendingKeys.add(key)`).
function registerPendingKey(streaks: Map<string, SkipIfBusyStreak>, key: string): void {
  streaks.delete(key)
}

describe('skipIfBusy + pending-retry ownership transition (Codex-requested regression scenario)', () => {
  it('a partial streak is discarded the moment the key enters pendingKeys, even if the retry resolves quickly', () => {
    const streaks = new Map<string, SkipIfBusyStreak>()
    const key = 'demo-task@demo-agent'
    // t=0 and t=10m: cron observes busy twice, streak building (not yet
    // escalated -- would need a 4th observation at t=30m to reach 30m elapsed).
    expect(tickOutcome(streaks, key, true, true, false, 0)).toBe('skip-silently')
    expect(tickOutcome(streaks, key, true, true, false, 10 * 60_000)).toBe('skip-silently')
    // t=15m: some OTHER path (a manual run, a race) creates a pending-retry
    // row for this exact key. The retry-registration loop discards the
    // streak unconditionally, regardless of what the retry eventually does.
    registerPendingKey(streaks, key)
    expect(streaks.has(key)).toBe(false)
    // t=20m: the retry loop (which polls every tick, not gated by cron)
    // fires successfully and the row is deleted -- POSITIVE evidence the old
    // episode ended. The cron loop never even ran attemptFireTask for this
    // key during [15m, 20m] (pendingKeys.has(key) skipped it), so it has no
    // way to know this happened -- which is exactly why the discard at
    // registration time (not a later "was it resolved" check) is the fix.
    //
    // t=30m: a NEW, independent busy observation comes in from the cron
    // loop. Without the fix, the gap since the LAST recorded observation
    // (t=10m) would be 20 minutes -- comfortably under the 25-minute
    // tolerance -- so the OLD streak (started at t=0) would silently resume
    // and this observation would immediately read as 30 minutes elapsed and
    // escalate on an episode that had already ended. With the fix, the Map
    // was already empty at t=15m, so this is treated as the FIRST
    // observation of a brand new streak.
    expect(tickOutcome(streaks, key, true, true, false, 30 * 60_000)).toBe('skip-silently')
  })

  it('the fresh post-retry streak still escalates normally once IT actually persists past the threshold', () => {
    const streaks = new Map<string, SkipIfBusyStreak>()
    const key = 'demo-task@demo-agent'
    tickOutcome(streaks, key, true, true, false, 0)
    registerPendingKey(streaks, key) // an unrelated retry takes ownership and clears
    // A genuinely NEW wedge starts at t=30m and is observed 4 times, 10
    // minutes apart -- must still escalate at its OWN 4th observation (60m),
    // exactly like any fresh */10 streak would.
    const TEN_MIN = 10 * 60_000
    const base = 30 * 60_000
    expect(tickOutcome(streaks, key, true, true, false, base)).toBe('skip-silently')
    expect(tickOutcome(streaks, key, true, true, false, base + TEN_MIN)).toBe('skip-silently')
    expect(tickOutcome(streaks, key, true, true, false, base + 2 * TEN_MIN)).toBe('skip-silently')
    expect(tickOutcome(streaks, key, true, true, false, base + 3 * TEN_MIN)).toBe('escalate')
  })
})

// Codex review (2026-09-05): the retry row this escalation creates starts its
// OWN clock at insertion time -- it does NOT inherit the 30 minutes already
// spent waiting. This test PINS that cascade as an intentional contract (see
// SKIP_IF_BUSY_ESCALATE_AFTER_MS's doc comment for the full reasoning), not an
// accidental delay: a silent change to any of the three constants involved
// would silently change how long BÉLA/the owner can go without a signal.
//
// NOT an upper bound (Codex review, 2026-09-05, correcting an earlier
// "AT MOST" framing): escalation time is cadence-dependent (see the doc
// comment), a slower-than-*/10 cadence takes longer than 30m to first
// escalate, and the session could already have been busy before this
// mechanism's first observation. This is the POLICY SUM the mechanism
// targets for `*/10` -- the ORIGINAL incident cadence and the
// most-analyzed case in this file, not a claim that it is the fastest
// cadence this mechanism could ever support -- not a ceiling that holds for
// every cadence.
describe('skipIfBusy escalation: policy-sum time-to-alert for the incident (*/10) cadence', () => {
  it('BÉLA is notified ~90 minutes after a */10-cadence streak starts (30m escalate + 60m stage-1 alert)', () => {
    expect(SKIP_IF_BUSY_ESCALATE_AFTER_MS + ALERT_THRESHOLD_MS).toBe(90 * 60_000)
  })

  it('the owner is notified ~165 minutes after a */10-cadence streak starts (30m escalate + 60m stage-1 + 75m stage-2)', () => {
    expect(SKIP_IF_BUSY_ESCALATE_AFTER_MS + ALERT_THRESHOLD_MS + OWNER_ESCALATION_EXTRA_MS).toBe(165 * 60_000)
  })
})

// Source-scan tests for the tick-loop WIRING only (that the real loop actually
// calls these functions, in the right order, with the right clearing) -- the
// loop itself is too I/O-heavy (tmux, DB, cron matching) to execute directly
// in a unit test without heavy mocking. Behavioral correctness is covered
// above via the real functions; these only guard against the wiring silently
// drifting away from them (e.g. a future edit re-inlining the threshold
// check instead of calling decideSkipIfBusyEscalation).
const SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')

describe('skipIfBusy escalation wiring (source-scan, wiring only)', () => {
  it('the tracked-streak branch consults decideSkipIfBusyEscalation and nextSkipIfBusyStreak, not re-implemented logic', () => {
    const skipIdx = SRC.indexOf('if (isTrackedSkipIfBusyStreak) {')
    expect(skipIdx).toBeGreaterThan(0)
    const branch = SRC.slice(skipIdx, skipIdx + 3200)
    expect(branch).toMatch(/nextSkipIfBusyStreak\(/)
    expect(branch).toMatch(/decideSkipIfBusyEscalation\(/)
  })

  it('the escalate path inserts a pending retry via the SAME function every other busy/starting/mcp-missing/first-run branch uses', () => {
    const skipIdx = SRC.indexOf('if (isTrackedSkipIfBusyStreak) {')
    const branch = SRC.slice(skipIdx, skipIdx + 3200)
    expect(branch).toMatch(/appendTaskRun\(task\.name, agentName, 'skipped'\)/)
    expect(branch).toMatch(/insertPendingTaskRetryIfNew\(task\.name, agentName, now, 'busy'\)/)
  })

  it('escalating clears the streak Map', () => {
    const skipIdx = SRC.indexOf('if (isTrackedSkipIfBusyStreak) {')
    const branch = SRC.slice(skipIdx, skipIdx + 3200)
    const escalateIdx = branch.indexOf('escalating to the retry/alert pipeline')
    expect(escalateIdx).toBeGreaterThan(0)
    expect(branch.slice(escalateIdx)).toMatch(/skipIfBusyStreaks\.delete\(key\)/)
  })

  it('the tracked-streak flag is scoped to busy + skipIfBusy + !forceSend', () => {
    const flagIdx = SRC.indexOf('const isTrackedSkipIfBusyStreak =')
    expect(flagIdx).toBeGreaterThan(0)
    const flagLine = SRC.slice(flagIdx, flagIdx + 200)
    expect(flagLine).toMatch(/result === 'busy'/)
    expect(flagLine).toMatch(/task\.skipIfBusy/)
    expect(flagLine).toMatch(/!task\.forceSend/)
  })

  it('any tick that is not a tracked streak tick clears the Map (not just "any non-busy result")', () => {
    const resultIdx = SRC.indexOf('const result = await attemptFireTask(task, agentName, now, cronPc.prefix, lateCatchUpMs)')
    expect(resultIdx).toBeGreaterThan(0)
    const afterResult = SRC.slice(resultIdx, resultIdx + 1400)
    expect(afterResult).toMatch(/if \(!isTrackedSkipIfBusyStreak\) skipIfBusyStreaks\.delete\(key\)/)
  })

  // Codex review (2026-09-05, BLOCKING on the v3 draft): the v3 draft placed
  // the discard AFTER the taskDef-missing/disabled early `continue`s, so a
  // row whose task got deleted/disabled while pending never had its streak
  // cleared -- exactly the poisoned-re-entry risk this fix exists to close,
  // just reached via re-enabling the task later. The discard must run before
  // ANY early exit in this loop, for EVERY row it touches, using the row's
  // own fields directly (the `key` local isn't computed yet at that point).
  it('the streak discard runs BEFORE the taskDef-missing/disabled early continues, not after', () => {
    const loopIdx = SRC.indexOf('for (const row of pendingRows) {')
    expect(loopIdx).toBeGreaterThan(0)
    const missingCheckIdx = SRC.indexOf('if (!taskDef) {', loopIdx)
    expect(missingCheckIdx).toBeGreaterThan(loopIdx)
    const beforeMissingCheck = SRC.slice(loopIdx, missingCheckIdx)
    expect(beforeMissingCheck).toMatch(/skipIfBusyStreaks\.delete\(`\$\{row\.task_name\}@\$\{row\.agent_name\}`\)/)
  })

  it('the cron loop ALSO clears the streak at its own pendingKeys.has(key) check (defense in depth)', () => {
    const hasIdx = SRC.indexOf('if (pendingKeys.has(key))')
    expect(hasIdx).toBeGreaterThan(0)
    const line = SRC.slice(hasIdx, hasIdx + 120)
    expect(line).toMatch(/skipIfBusyStreaks\.delete\(key\)/)
  })
})
