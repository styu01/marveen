import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Codex review point 1 (kanban 0d8bf173, round 2): the new PUT
// /api/agents/:name/context-restart-gate route is worthless if nothing reads
// the config it writes. `checkAgent` (context-restart-gate-runner.ts) is the
// exact function the live sweep calls on every tick, exported specifically so
// this can be proven end-to-end: write a config the same way the route does
// (via writeGateConfig), then call checkAgent directly and assert on the
// process boundary (execFileSync) it actually crosses -- not on the store,
// which would only prove the write, not the wiring.
const SANDBOX = mkdtempSync(join(tmpdir(), 'gate-wiring-'))
mkdirSync(join(SANDBOX, 'store'), { recursive: true })

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'testmain', PROJECT_ROOT: SANDBOX }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({
  getDispatchedPendingStats: vi.fn(() => ({ count: 0, hasStale: false })),
  // LEDGERACK905 (ported from upstream Szotasz/marveen 4fb9fbcbf, 2026-09-10):
  // the runner now calls openInboundQuestionMessageId, not
  // hasOpenInboundQuestion (kept in db.ts for other callers, but unused here).
  // Mocking only the old name would silently fall through the runner's own
  // try/catch to `false` on every call -- passing, but no longer exercising
  // the real wiring. null = "nothing open", matching the old mock's false.
  openInboundQuestionMessageId: vi.fn(() => null),
  hasOpenKanbanCardForAssignee: vi.fn(() => false),
  createAgentMessage: vi.fn(),
}))
vi.mock('../web/context-restart-transcript-archive.js', () => ({
  archiveTranscriptBeforeContextRestart: vi.fn(() => ({
    path: '/cold/archive.txt', sourcePath: '/session.jsonl',
  })),
}))
vi.mock('../web/usage-fleet-pause.js', () => ({
  readFleetPauseState: vi.fn(() => ({ paused: false })),
}))
vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (n: string) => `agent-${n}`,
  capturePane: vi.fn(() => 'fake pane content\n$ '),
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: vi.fn(() => 'idle'),
}))
vi.mock('../model-fallback.js', () => ({
  detectsUsageLimit: vi.fn(() => false),
}))
vi.mock('../web/active-model.js', () => ({
  readContextTokensFromProjectDir: vi.fn(() => 0),
}))
vi.mock('../web/main-agent.js', () => ({
  MAIN_CHANNELS_SESSION: 'testmain-channels',
}))
vi.mock('../web/context-guard-runner.js', () => ({
  getHardGuardPhase: vi.fn(() => 'idle'),
}))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: vi.fn(() => []),
  readAgentClaudeConfigDir: vi.fn(() => undefined),
}))

// Single dispatcher mock for node:child_process's execFileSync, branching on
// the tmux/ps arg shape (see context-restart-gate-runner.ts's own comments on
// "direct shape" pane-process detection for why each branch exists).
const execFileSyncMock = vi.fn((_cmd: string, args?: string[]) => {
  if (args?.[0] === 'list-panes') return '12345\n'          // getPanePid
  if (args?.[0] === '--ppid') return ''                      // getChildPids -> no children
  if (args?.includes?.('etimes=')) return '120\n'             // getPidAgeSeconds
  if (args?.includes?.('comm=')) return 'claude\n'            // getCommForPid (direct shape: pane IS claude)
  if (args?.[0] === 'send-keys') return ''                    // the /clear + Enter sends
  return ''
})
vi.mock('node:child_process', () => ({ execFileSync: execFileSyncMock }))

const { checkAgent } = await import('../web/context-restart-gate-runner.js')
const { writeGateConfig, readGateRunState } = await import('../web/context-restart-gate-store.js')
const { readContextTokensFromProjectDir } = await import('../web/active-model.js')
const { PRE_CLEAR_NOTICE_MS } = await import('../context-restart-gate.js')
const { hasOpenKanbanCardForAssignee, createAgentMessage, openInboundQuestionMessageId } = await import('../db.js')
const { archiveTranscriptBeforeContextRestart } = await import('../web/context-restart-transcript-archive.js')
const { readFleetPauseState } = await import('../web/usage-fleet-pause.js')

beforeEach(() => {
  execFileSyncMock.mockClear()
  vi.mocked(hasOpenKanbanCardForAssignee).mockReset()
  vi.mocked(hasOpenKanbanCardForAssignee).mockReturnValue(false)
  vi.mocked(openInboundQuestionMessageId).mockReset()
  vi.mocked(openInboundQuestionMessageId).mockReturnValue(null)
  vi.mocked(createAgentMessage).mockClear()
  vi.mocked(archiveTranscriptBeforeContextRestart).mockReset()
  vi.mocked(archiveTranscriptBeforeContextRestart).mockReturnValue({
    path: '/cold/archive.txt', sourcePath: '/session.jsonl',
  })
  vi.mocked(readFleetPauseState).mockReset()
  vi.mocked(readFleetPauseState).mockReturnValue({ paused: false })
})
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }))

describe('context-restart-gate wiring: config store -> live sweep', () => {
  it('disabled config: checkAgent never touches tmux', async () => {
    // No writeGateConfig call for this agent -- readGateConfig falls back to
    // DEFAULT_GATE_CONFIG, whose enabled is false. This is the state every
    // agent is in right now (kanban 0d8bf173: build the switch, don't flip it).
    await checkAgent('worker-disabled', Date.now())

    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('enabled config + all-clear inputs: sends a ten-minute notice, then /clear via tmux send-keys', async () => {
    const name = 'worker-enabled'
    // Mirrors exactly what PUT /api/agents/:name/context-restart-gate writes.
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValue(500) // >= thresholdTokens

    const nowMs = Date.now()
    await checkAgent(name, nowMs)

    // The first all-clear sweep must never clear immediately: it gives the
    // agent a bounded opportunity to write a concise warm state note.
    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.includes('/clear'))).toBe(false)
    expect(readGateRunState(name).preClearNoticeAt).toBe(nowMs)

    // The fixed notice must be the approved full ten minutes. At the halfway
    // point the countdown is still a hard
    // stop; at the exact boundary the re-check may proceed to /clear.
    expect(PRE_CLEAR_NOTICE_MS).toBe(10 * 60_000)
    await checkAgent(name, nowMs + PRE_CLEAR_NOTICE_MS / 2)
    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.includes('/clear'))).toBe(false)

    await checkAgent(name, nowMs + PRE_CLEAR_NOTICE_MS)

    // Crossed the process boundary: the actual send-keys call the runner's
    // 'allow' branch makes, not just an in-process assertion on the store.
    const sendKeysCalls = execFileSyncMock.mock.calls.filter(([, args]) => args?.[0] === 'send-keys')
    expect(sendKeysCalls.length).toBeGreaterThan(0)
    expect(sendKeysCalls.some(([, args]) => args?.includes('/clear'))).toBe(true)
    expect(archiveTranscriptBeforeContextRestart).toHaveBeenCalledWith(expect.objectContaining({
      agent: name,
      workingDir: join(SANDBOX, 'agents', name),
      nowMs: nowMs + PRE_CLEAR_NOTICE_MS,
    }))
    const firstClearSend = execFileSyncMock.mock.calls.findIndex(([, args]) => args?.includes('/clear'))
    expect(firstClearSend).toBeGreaterThanOrEqual(0)
    expect(vi.mocked(archiveTranscriptBeforeContextRestart).mock.invocationCallOrder[0])
      .toBeLessThan(execFileSyncMock.mock.invocationCallOrder[firstClearSend])

    // And the run-state round-trips through the real (sandboxed) store, same
    // as the live sweep would leave it for the next tick.
    const runState = readGateRunState(name)
    expect(runState.lastClearAt).toBe(nowMs + PRE_CLEAR_NOTICE_MS)
    expect(runState.firstBlockedAt).toBeNull()
    expect(runState.preClearNoticeAt).toBeNull()
  })

  it('disabled config for a second agent still never touches tmux, even after the enabled one fired', async () => {
    // Guards against a shared-mutable-state false pass: prove the fast-exit
    // still holds per-agent, not just "the mock was clean at suite start".
    await checkAgent('worker-still-disabled', Date.now())

    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('assigned unfinished Kanban work blocks /clear even with every process-level signal clear', async () => {
    const name = 'worker-kanban-open'
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValueOnce(500)
    vi.mocked(hasOpenKanbanCardForAssignee).mockReturnValueOnce(true)

    await checkAgent(name, Date.now())

    expect(archiveTranscriptBeforeContextRestart).not.toHaveBeenCalled()
    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.[0] === 'send-keys')).toBe(false)
  })

  it('fails closed when the Kanban query itself throws', async () => {
    const name = 'worker-kanban-unmeasurable'
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValueOnce(500)
    vi.mocked(hasOpenKanbanCardForAssignee).mockImplementationOnce(() => { throw new Error('db unavailable') })

    await checkAgent(name, Date.now())

    expect(archiveTranscriptBeforeContextRestart).not.toHaveBeenCalled()
    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.[0] === 'send-keys')).toBe(false)
  })

  it('never sends /clear when the mandatory pre-clear transcript archive fails', async () => {
    const name = 'worker-archive-failed'
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValue(500)
    const nowMs = Date.now()
    await checkAgent(name, nowMs) // pre-clear notice
    vi.mocked(archiveTranscriptBeforeContextRestart).mockImplementationOnce(() => {
      throw new Error('no transcript')
    })

    await checkAgent(name, nowMs + PRE_CLEAR_NOTICE_MS)

    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.[0] === 'send-keys')).toBe(false)
    expect(readGateRunState(name).lastClearAt).toBeNull()
    expect(readGateRunState(name).preClearNoticeAt).toBeNull()

    await checkAgent(name, nowMs + 6 * 60_000)
    expect(readGateRunState(name).preClearNoticeAt).toBe(nowMs + 6 * 60_000)
  })

  it('does not send a pre-clear notice or clear while the shared usage fleet pause is active', async () => {
    const name = 'worker-usage-paused'
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValueOnce(500)
    vi.mocked(readFleetPauseState).mockReturnValueOnce({ paused: true, metric: 'five_hour', percent: 91 })

    await checkAgent(name, Date.now())

    expect(createAgentMessage).not.toHaveBeenCalled()
    expect(archiveTranscriptBeforeContextRestart).not.toHaveBeenCalled()
    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.[0] === 'send-keys')).toBe(false)
    expect(readGateRunState(name).preClearNoticeAt).toBeNull()
  })

  it('invalidates an old notice when new Kanban work appears, requiring a fresh notice after it clears', async () => {
    const name = 'worker-notice-invalidated'
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValue(500)
    const nowMs = Date.now()
    await checkAgent(name, nowMs)
    expect(readGateRunState(name).preClearNoticeAt).toBe(nowMs)

    vi.mocked(hasOpenKanbanCardForAssignee).mockReturnValueOnce(true)
    await checkAgent(name, nowMs + PRE_CLEAR_NOTICE_MS)
    expect(readGateRunState(name).preClearNoticeAt).toBeNull()
    expect(execFileSyncMock.mock.calls.some(([, args]) => args?.includes('/clear'))).toBe(false)

    await checkAgent(name, nowMs + 6 * 60_000)
    expect(readGateRunState(name).preClearNoticeAt).toBe(nowMs + 6 * 60_000)
  })
})
