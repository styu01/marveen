import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// SONWIN905 (2026-09-05): the prep-nudge tier's `prepNudgeSent` flag must only
// be committed on a CONFIRMED delivery (sendPromptToSession returning 'sent'),
// never merely on "the call did not throw" -- the function can also resolve
// 'aborted-busy' or 'skipped-locked' without throwing, and treating either of
// those as "delivered" would silently swallow the nudge with no retry. This
// integration-level test drives the actual exported checkAgent() (not the pure
// decideGuard logic, which context-guard.test.ts already covers) through a
// mocked sendPromptToSession so both outcomes are pinned as a regression test.

const SANDBOX = mkdtempSync(join(tmpdir(), 'context-guard-runner-test-'))

// Codex review (SONWIN905 v5, 2026-09-05, non-blocking): nothing removed this
// directory, so every test run left one more empty dir behind in the OS temp
// folder. Not a correctness issue -- each run gets its own unique mkdtempSync
// path -- but an unbounded leak on every invocation is worth closing.
afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true })
})

let sendResult: 'sent' | 'aborted-busy' | 'skipped-locked' = 'sent'
const sendPromptToSession = vi.fn(async () => sendResult)

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))
vi.mock('../pane-state.js', () => ({
  detectPaneState: () => 'idle',          // pane idle, not busy -- the send is allowed to fire
  paneShowsContextSaturation: () => false,
}))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => [],
  listAllAgentNames: () => [],
  agentDir: (n: string) => join(SANDBOX, 'agents', n),
  readAgentModel: () => 'claude-sonnet-5',
  readAgentClaudeConfigDir: () => null,
  readAgentRemoteHost: () => null,
}))
vi.mock('../web/agent-process.js', () => ({
  agentRunState: () => 'running',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: () => 'mock pane contents',
  sendPromptToSession,
  isSessionReadyForPrompt: async () => false,
}))
vi.mock('../web/active-model.js', () => ({
  // 830_000 tokens sits between prepPct (0.85 * 967_000 = 821_950) and actPct
  // (0.90 * 967_000 = 870_300) for claude-sonnet-5's corrected denominator --
  // squarely in the prep band, below the wedge tiers.
  readContextTokensFromProjectDir: () => 830_000,
  readActiveModelFromProjectDir: () => 'claude-sonnet-5',
  readTranscriptMtimeFromProjectDir: () => null,
}))
vi.mock('../web/context-guard-store.js', () => ({
  readContextGuardConfig: () => ({
    enabled: true,
    saturationRestart: true,
    actPct: 0.90,
    hardPct: 0.97,
    prepPct: 0.85,
    limitTokens: null,
    cooldownMinutes: 15,
    handoffTimeoutMinutes: 20,
    idleFlushEnabled: false,
    idleFlushTokens: 400_000,
    idleMinutes: 20,
  }),
}))

const { checkAgent } = await import('../web/context-guard-runner.js')

beforeEach(() => {
  sendPromptToSession.mockClear()
  sendResult = 'sent'
})

// Each case uses its OWN agent name: the runner's guardStates map is
// module-private and keyed by name, so reusing one name across it()s would
// leak prepNudgeSent state between otherwise-independent scenarios. A fresh
// name always starts at INITIAL_GUARD_STATE, exactly like a fresh agent would.
describe('checkAgent: prep-nudge delivery confirmation (SONWIN905)', () => {
  it('a confirmed "sent" delivery is NOT retried on the next sweep', async () => {
    const agent = 'prep-test-sent'
    await checkAgent(agent, 1_000_000_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(1)
    // Second sweep, same (still-growing-but-unchanged-here) pct: the nudge
    // already went out this growth cycle, so it must not fire again.
    await checkAgent(agent, 1_000_000_000 + 300_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(1)
  })

  it('an "aborted-busy" (non-throwing) result is NOT treated as delivered -- retried next sweep', async () => {
    const agent = 'prep-test-aborted-busy'
    sendResult = 'aborted-busy'
    await checkAgent(agent, 2_000_000_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(1)
    // Still not confirmed sent: the very next sweep must try again.
    sendResult = 'aborted-busy'
    await checkAgent(agent, 2_000_000_000 + 300_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(2)
    // Once it actually lands, the flag commits and the retries stop.
    sendResult = 'sent'
    await checkAgent(agent, 2_000_000_000 + 600_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(3)
    await checkAgent(agent, 2_000_000_000 + 900_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(3)
  })

  it('a "skipped-locked" (non-throwing) result is likewise retried, not recorded as sent', async () => {
    const agent = 'prep-test-skipped-locked'
    sendResult = 'skipped-locked'
    await checkAgent(agent, 3_000_000_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(1)
    sendResult = 'skipped-locked'
    await checkAgent(agent, 3_000_000_000 + 300_000)
    expect(sendPromptToSession).toHaveBeenCalledTimes(2)
  })
})
