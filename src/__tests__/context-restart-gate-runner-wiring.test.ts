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
  hasOpenInboundQuestion: vi.fn(() => false),
  createAgentMessage: vi.fn(),
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

beforeEach(() => {
  execFileSyncMock.mockClear()
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

  it('enabled config + all-clear inputs: checkAgent sends /clear via tmux send-keys', async () => {
    const name = 'worker-enabled'
    // Mirrors exactly what PUT /api/agents/:name/context-restart-gate writes.
    writeGateConfig(name, { enabled: true, thresholdTokens: 100 })
    vi.mocked(readContextTokensFromProjectDir).mockReturnValueOnce(500) // >= thresholdTokens

    const nowMs = Date.now()
    await checkAgent(name, nowMs)

    // Crossed the process boundary: the actual send-keys call the runner's
    // 'allow' branch makes, not just an in-process assertion on the store.
    const sendKeysCalls = execFileSyncMock.mock.calls.filter(([, args]) => args?.[0] === 'send-keys')
    expect(sendKeysCalls.length).toBeGreaterThan(0)
    expect(sendKeysCalls.some(([, args]) => args?.includes('/clear'))).toBe(true)

    // And the run-state round-trips through the real (sandboxed) store, same
    // as the live sweep would leave it for the next tick.
    const runState = readGateRunState(name)
    expect(runState.lastClearAt).toBe(nowMs)
    expect(runState.firstBlockedAt).toBeNull()
  })

  it('disabled config for a second agent still never touches tmux, even after the enabled one fired', async () => {
    // Guards against a shared-mutable-state false pass: prove the fast-exit
    // still holds per-agent, not just "the mock was clean at suite start".
    await checkAgent('worker-still-disabled', Date.now())

    expect(execFileSyncMock).not.toHaveBeenCalled()
  })
})
