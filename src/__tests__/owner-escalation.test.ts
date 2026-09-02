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

import {
  decideOwnerEscalation,
  escalateToOwner,
  clearOwnerEscalation,
  _resetAllOwnerEscalationsForTest,
  _getOwnerEscalationStateForTest,
  DEFAULT_STAGE2_EXTRA_MS,
  STAGE2_TRANSIENT_RETRY_MS,
  STAGE2_PERMANENT_RETRY_MS,
  STAGE1_RETRY_MS,
  STAGE1_MAX_ATTEMPTS,
} from '../web/owner-escalation.js'

describe('decideOwnerEscalation (pure, standalone predicate)', () => {
  const T0 = 1_000_000

  it('stage 1 is due when never escalated before', () => {
    expect(decideOwnerEscalation({ stage1At: null, stage2At: null }, 1000)).toEqual({ stage1Due: true, stage2Due: false })
  })

  it('stage 2 is not due before stage2ExtraMs has elapsed', () => {
    expect(decideOwnerEscalation({ stage1At: T0, stage2At: null }, T0 + DEFAULT_STAGE2_EXTRA_MS - 1).stage2Due).toBe(false)
  })

  it('stage 2 is due once stage2ExtraMs has elapsed', () => {
    expect(decideOwnerEscalation({ stage1At: T0, stage2At: null }, T0 + DEFAULT_STAGE2_EXTRA_MS + 1)).toEqual({ stage1Due: false, stage2Due: true })
  })

  it('stage 2 is never due again once already sent', () => {
    expect(decideOwnerEscalation({ stage1At: T0, stage2At: T0 + 1 }, T0 + 999_999).stage2Due).toBe(false)
  })
})

describe('escalateToOwner: stage 1 fires immediately, stage 2 is TIMER-driven (not re-invocation-driven)', () => {
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

  it('first call sends the BÉLA (stage-1) notice immediately, not the owner alert', async () => {
    escalateToOwner({ key: 'agent-x', belaText: 'bela text', ownerText: 'owner text' })
    expect(mockCreateAgentMessage).toHaveBeenCalledWith('system', 'bela', 'bela text')
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()
  })

  it('THE CORE FIX: stage 2 fires from a SINGLE call, with no re-invocation at all -- the exact demand-driven scenario (agent-worker.ts) Codex confirmed was broken in the re-invocation-driven design', async () => {
    escalateToOwner({ key: 'worker-stuck:x', belaText: 'bela text', ownerText: 'owner text' })
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)

    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith('owner text')
  })

  it('integration scenario (Codex\'s requested shape): t0 stuck -> t0+3m resolved (cleared) -> NO stage-2 alert ever fires', async () => {
    escalateToOwner({ key: 'incident-1', belaText: 'bela text', ownerText: 'owner text' })
    await vi.advanceTimersByTimeAsync(3 * 60 * 1000) // t0+3m: resolved before stage2ExtraMs (5m)
    clearOwnerEscalation('incident-1')

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000) // well past what would have been t0+5m
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()
  })

  it('integration scenario: t0 stuck -> t0+5m still stuck -> stage-2 fires exactly once', async () => {
    escalateToOwner({ key: 'incident-2', belaText: 'bela text', ownerText: 'owner text v1' })
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000) // t0+4m: still stuck, caller re-checks (harmless, refreshes text)
    escalateToOwner({ key: 'incident-2', belaText: 'bela text', ownerText: 'owner text v2 (fresher)' })
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1) // stage 1 does NOT refire

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000) // now past t0+5m
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith('owner text v2 (fresher)') // used the FRESHEST text, not the t0 snapshot
  })

  it('a repeat call before the timer fires never sends a second stage-1 or an early stage-2', async () => {
    escalateToOwner({ key: 'agent-y', belaText: 'bela text', ownerText: 'owner text' })
    mockCreateAgentMessage.mockClear()
    escalateToOwner({ key: 'agent-y', belaText: 'bela text', ownerText: 'owner text' })
    expect(mockCreateAgentMessage).not.toHaveBeenCalled()
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()
  })

  it('clearOwnerEscalation cancels the pending stage-2 timer', async () => {
    escalateToOwner({ key: 'agent-z', belaText: 'bela text', ownerText: 'owner text' })
    clearOwnerEscalation('agent-z')
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1000)
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()
  })

  it('clearOwnerEscalation then a fresh call starts a genuinely new stage-1/stage-2 cycle', async () => {
    escalateToOwner({ key: 'agent-w', belaText: 'bela 1', ownerText: 'owner 1' })
    clearOwnerEscalation('agent-w')
    mockCreateAgentMessage.mockClear()
    escalateToOwner({ key: 'agent-w', belaText: 'bela 2', ownerText: 'owner 2' })
    expect(mockCreateAgentMessage).toHaveBeenCalledWith('system', 'bela', 'bela 2')
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith('owner 2')
  })

  it('round 3 fix: a failed stage-1 send auto-retries on its OWN timer -- no second escalateToOwner call needed', async () => {
    mockCreateAgentMessage.mockImplementationOnce(() => { throw new Error('db down') })
    escalateToOwner({ key: 'agent-fail1', belaText: 'bela text', ownerText: 'owner text' })
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)

    // Nothing else ever calls escalateToOwner again (the exact demand-driven
    // scenario Codex's round-3 review flagged: this is the SAME lost-
    // escalation pattern round 2 fixed for stage 2, one step earlier).
    mockCreateAgentMessage.mockReturnValueOnce({ id: 2 })
    await vi.advanceTimersByTimeAsync(STAGE1_RETRY_MS + 1)
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(2) // retried on its own

    // And stage 2 still eventually fires from there.
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith('owner text')
  })

  it('round 3 fix: after STAGE1_MAX_ATTEMPTS consecutive stage-1 failures, falls back to a DIRECT, clearly-labeled owner alert instead of waiting forever for BÉLA', async () => {
    mockCreateAgentMessage.mockImplementation(() => { throw new Error('db permanently down') })
    escalateToOwner({ key: 'agent-bela-unreachable', belaText: 'bela text', ownerText: 'owner text' })

    for (let i = 1; i < STAGE1_MAX_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(STAGE1_RETRY_MS + 1)
    }
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(STAGE1_MAX_ATTEMPTS)
    // The last attempt's failure triggers the fallback in the SAME tick, no
    // extra timer wait needed for the fallback SEND itself to be attempted.
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
    const sentText = mockNotifyChannelOrThrow.mock.calls[0][0] as string
    expect(sentText).toContain('nem volt elerheto') // clearly labeled as a BÉLA-unreachable fallback
    expect(sentText).toContain('owner text') // still carries the real incident text
    expect(_getOwnerEscalationStateForTest('agent-bela-unreachable')?.stage2At).not.toBeNull()
  })

  it('round 3 fix: a retry of the BÉLA-unreachable fallback send does NOT loop back into re-attempting createAgentMessage', async () => {
    mockCreateAgentMessage.mockImplementation(() => { throw new Error('db permanently down') })
    mockNotifyChannelOrThrow.mockRejectedValueOnce(new Error('Telegram API 500: down')).mockResolvedValueOnce(undefined)
    escalateToOwner({ key: 'agent-fallback-retry', belaText: 'bela text', ownerText: 'owner text' })

    for (let i = 1; i < STAGE1_MAX_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(STAGE1_RETRY_MS + 1)
    }
    const stage1CallsAtFallback = mockCreateAgentMessage.mock.calls.length
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1) // fallback attempted, failed (transient)

    await vi.advanceTimersByTimeAsync(STAGE2_TRANSIENT_RETRY_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(2) // fallback RETRIED, succeeded
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(stage1CallsAtFallback) // stage-1 NEVER re-attempted
  })

  it('a TRANSIENT stage-2 delivery failure retries on a short backoff and eventually succeeds', async () => {
    mockNotifyChannelOrThrow
      .mockRejectedValueOnce(new Error('Telegram API 500: server error'))
      .mockResolvedValueOnce(undefined)
    escalateToOwner({ key: 'agent-transient', belaText: 'bela text', ownerText: 'owner text' })

    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1) // first attempt, failed

    await vi.advanceTimersByTimeAsync(STAGE2_TRANSIENT_RETRY_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(2) // retried, succeeded
    expect(_getOwnerEscalationStateForTest('agent-transient')?.stage2At).not.toBeNull()
  })

  it('a PERMANENT stage-2 delivery failure backs off much longer (does not spam)', async () => {
    mockNotifyChannelOrThrow.mockRejectedValue(new Error('Telegram API 401: unauthorized'))
    escalateToOwner({ key: 'agent-permanent', belaText: 'bela text', ownerText: 'owner text' })

    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(STAGE2_TRANSIENT_RETRY_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1) // NOT retried yet -- permanent backoff is much longer

    await vi.advanceTimersByTimeAsync(STAGE2_PERMANENT_RETRY_MS)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(2)
  })

  it('a stage-2 failure never marks stage2At as sent -- delivery must be CONFIRMED, not assumed', async () => {
    mockNotifyChannelOrThrow.mockRejectedValue(new Error('Telegram API 500: down'))
    escalateToOwner({ key: 'agent-unconfirmed', belaText: 'bela text', ownerText: 'owner text' })
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)
    expect(_getOwnerEscalationStateForTest('agent-unconfirmed')?.stage2At).toBeNull()
  })

  it('independent keys have independent stage timers', async () => {
    escalateToOwner({ key: 'agent-a', belaText: 'a', ownerText: 'a-owner' })
    escalateToOwner({ key: 'agent-b', belaText: 'b', ownerText: 'b-owner' })
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(DEFAULT_STAGE2_EXTRA_MS + 1)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith('a-owner')
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledWith('b-owner')
  })

  it('respects a custom stage2ExtraMs override', async () => {
    escalateToOwner({ key: 'agent-custom', belaText: 'b', ownerText: 'o', stage2ExtraMs: 60_000 })
    await vi.advanceTimersByTimeAsync(59_000)
    expect(mockNotifyChannelOrThrow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockNotifyChannelOrThrow).toHaveBeenCalledTimes(1)
  })
})
