import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Contract tests for the main-agent transient-respawn fix.
//
// Root cause (found by an independent federated-peer audit, verified against
// the live dashboard log): the main agent's tmux session (`<id>-channels`) is
// service-managed, not a directory under AGENTS_BASE_DIR. When that session
// was transiently missing (e.g. mid-respawn) at the moment a cron task fired,
// attemptFireTask's session-missing branch called startAgentProcess('bela'),
// which misreported 'Agent not found' (agentDir() has nothing to find for the
// main agent) -- a real config-error case, not a transient one. That 'missing'
// result then reached the pending-retry loop, which permanently deletes the
// retry row on 'missing'. Confirmed incident: 2026-08-18 07:31:39 the
// kanban-audit task (agent=bela) was lost this way while bela-channels was
// mid-respawn; the session came back on its own by 07:31:50 (11s later) and
// fired a different task successfully at 07:31:55 -- proof a retry would
// have delivered had the row survived.
//
// Approved fix (BÉLA/István, minimal scope): the main agent gets its own
// branch in the session-missing guard, BEFORE startAgentProcess is called.
// It never reports 'missing' for a transiently-down main session -- it
// reuses the existing 'starting' state (bypasses skipIfBusy, is never
// deleted by the pending-retry loop's `'fired' || 'missing'` branch) and
// leaves actual recovery to the mechanisms that already own it (channel-
// monitor's down-cascade, watchdog.sh, context-guard-runner) instead of
// calling a restart itself, which would race those and risk repeating the
// 2026-08-06 4.5h multi-actor-restart outage.
//
// Out of scope (explicitly deferred by BÉLA): codex's broader "overdue-guard"
// / delivery-lifecycle proposal. Not touched, not tested here.

const SRC = readFileSync(join(__dirname, '../web/schedule-runner.ts'), 'utf-8')

describe('schedule-runner treats a transiently-down main session as "starting", not "missing"', () => {
  const guardIdx = SRC.indexOf('if (!sessionExistsOnHost(')

  it('the missing-session guard exists', () => {
    expect(guardIdx).toBeGreaterThan(0)
  })

  it('branches on isMainAgent before ever calling startAgentProcess', () => {
    const startIdx = SRC.indexOf('startAgentProcess(agentName)', guardIdx)
    const mainBranchIdx = SRC.indexOf('if (isMainAgent)', guardIdx)
    expect(mainBranchIdx).toBeGreaterThan(guardIdx)
    expect(mainBranchIdx).toBeLessThan(startIdx)
  })

  it('the main-agent branch returns "starting", never "missing"', () => {
    const mainBranchIdx = SRC.indexOf('if (isMainAgent)', guardIdx)
    const startIdx = SRC.indexOf('startAgentProcess(agentName)', guardIdx)
    // Slice up to the (verified-later, non-main) startAgentProcess call
    // rather than the first '}' -- the logger.warn(...) call's own object
    // literal closes with a '}' before the branch's actual closing brace.
    const mainBranch = SRC.slice(mainBranchIdx, startIdx)
    expect(mainBranch).toMatch(/return 'starting'/)
    expect(mainBranch).not.toMatch(/return 'missing'/)
  })

  it('documents why the scheduler defers instead of restarting the session itself', () => {
    const mainBranchIdx = SRC.indexOf('if (isMainAgent)', guardIdx)
    const rationale = SRC.slice(guardIdx, mainBranchIdx)
    expect(rationale).toMatch(/service-managed/i)
    expect(rationale).toMatch(/down-cascade|watchdog|context-guard-runner/i)
    expect(rationale).toMatch(/race/i)
  })

  it('a non-main agent with a genuinely missing directory still returns "missing"', () => {
    // The fix must not touch the pre-existing behaviour for real sub-agents:
    // a startAgentProcess failure for them still permanently drops the retry.
    const startIdx = SRC.indexOf('startAgentProcess(agentName)', guardIdx)
    const afterStart = SRC.slice(startIdx, startIdx + 700)
    expect(afterStart).toMatch(/return 'missing'/)
  })

  it('the pending-retry loop only permanently deletes on "fired" or "missing", never "starting"', () => {
    // This is the second half of the approved fix: since the main-agent
    // branch above now returns 'starting' instead of 'missing', it
    // automatically lands in the non-deleting refresh path here.
    const deleteIdx = SRC.indexOf("if (result === 'fired' || result === 'missing')")
    expect(deleteIdx).toBeGreaterThan(0)
    const deleteLine = SRC.slice(deleteIdx, deleteIdx + 120)
    expect(deleteLine).not.toMatch(/'starting'/)
  })
})
