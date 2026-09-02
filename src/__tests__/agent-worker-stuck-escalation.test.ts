// End-to-end integration test for the EXACT site Codex's review round 2
// (kanban cf12a93a, 2026-09-02) confirmed as genuinely broken under the
// original re-invocation-driven owner-escalation design: alertWorkerStuck()
// is called on-demand only (when someone dispatches a worker task and it
// isn't ready), never on a guaranteed periodic sweep -- so if nothing
// happened to trigger a SECOND call while the worker stayed stuck, stage 2
// would never fire. This drives the REAL function (not a synthetic key) end
// to end with fake timers to prove the timer-based redesign closes it: a
// SINGLE call is now sufficient for both stages.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCreateAgentMessage = vi.fn((..._a: unknown[]) => ({ id: 1 }))
const mockNotifyChannelOrThrow = vi.fn((..._a: unknown[]) => Promise.resolve())

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  MAIN_AGENT_ID: 'bela',
}))

vi.mock('../db.js', () => ({
  createAgentMessage: (...a: unknown[]) => mockCreateAgentMessage(...a),
}))

vi.mock('../notify.js', () => ({
  notifyChannelOrThrow: (...a: unknown[]) => mockNotifyChannelOrThrow(...a),
}))

import { alertWorkerStuck, makeWorkerCtx } from '../web/agent-worker.js'
import { DEFAULT_STAGE2_EXTRA_MS, _resetAllOwnerEscalationsForTest } from '../web/owner-escalation.js'

describe('agent-worker.ts: alertWorkerStuck, called exactly once (the demand-driven case), still reaches Istvan', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockCreateAgentMessage.mockReturnValue({ id: 1 })
    mockNotifyChannelOrThrow.mockResolvedValue(undefined)
    _resetAllOwnerEscalationsForTest()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a single alertWorkerStuck call sends the BÉLA notice immediately and the owner alert after DEFAULT_STAGE2_EXTRA_MS, with NO second call ever happening', async () => {
    const ctx = makeWorkerCtx('agent-worker-test-session', '/tmp/worker-home')

    alertWorkerStuck(ctx, 'some stuck pane tail')

    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)
    expect(mockCreateAgentMessage).toHaveBeenCalledWith('system', 'bela', expect.stringContaining('worker-stuck'))
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()

    // Simulate the realistic demand-driven gap: nobody dispatches another
    // worker task for a long time (this is exactly the scenario Codex
    // pointed at -- "ejszaka, vagy ha az adott funkciot ritkan hasznaljak").
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1000)

    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith(expect.stringContaining(ctx.session))
  })

  it('the 1-hour cooldown between DISPATCH ATTEMPTS still gates repeat calls, but does not gate whether stage 2 eventually fires from the first one', async () => {
    const ctx = makeWorkerCtx('agent-worker-test-session-2', '/tmp/worker-home-2')
    alertWorkerStuck(ctx, 'pane tail 1')
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)

    // A second dispatch attempt 5 minutes later (well within the 1h cooldown)
    // is suppressed by ctx.lastStuckAlert -- this is the EXISTING throttle,
    // unrelated to the escalation timer, still working as designed.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    alertWorkerStuck(ctx, 'pane tail 2')
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1) // still 1, cooldown suppressed the repeat

    // The stage-2 TIMER from the FIRST call still fires on schedule regardless.
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
  })
})
