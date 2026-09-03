// EFFORT806-B (2026-09-03): per-agent reasoning effort for SUB-agents.
//
// da4c801 (EFFORT806) wired --effort into the MAIN agent's launch path only.
// Its own commit message claimed sub-agents "already pass --effort via a
// different code path in agent-process.ts" -- that claim did not hold up:
// KISPROGI's 2026-09-02 audit found ZERO code anywhere constructing an
// --effort flag for a sub-agent launch (repo-wide grep), and the
// `effortLevel` field already present in several agents' agent-config.json
// (autobot/kisprogi/progi/vizsla/okoska all carried "high") was never read
// by anything -- confirmed live by inspecting the real /proc/<pid>/cmdline of
// four running sub-agents, none of which had --effort.
//
// This suite locks: (1) readAgentEffort() reads the config field correctly
// with no invented default, (2) startAgentProcess's launch command actually
// includes the flag when the config carries one.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAgentEffort, AGENTS_BASE_DIR } from '../web/agent-config.js'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const FIXTURES: Record<string, Record<string, unknown> | null> = {
  'effort-wiring-high': { model: 'claude-sonnet-5', effortLevel: 'high' },
  'effort-wiring-unset': { model: 'claude-sonnet-5' },
  'effort-wiring-blank': { model: 'claude-sonnet-5', effortLevel: '' },
  'effort-wiring-nonstring': { model: 'claude-sonnet-5', effortLevel: 42 },
  'effort-wiring-nofile': null, // directory exists, no agent-config.json at all
}

beforeAll(() => {
  for (const [name, cfg] of Object.entries(FIXTURES)) {
    mkdirSync(join(AGENTS_BASE_DIR, name), { recursive: true })
    if (cfg !== null) writeFileSync(join(AGENTS_BASE_DIR, name, 'agent-config.json'), JSON.stringify(cfg))
  }
})

afterAll(() => {
  for (const name of Object.keys(FIXTURES)) rmSync(join(AGENTS_BASE_DIR, name), { recursive: true, force: true })
})

describe('readAgentEffort', () => {
  it('reads the effortLevel field when present', () => {
    expect(readAgentEffort('effort-wiring-high')).toBe('high')
  })

  it('returns empty (no invented default) when effortLevel is absent', () => {
    expect(readAgentEffort('effort-wiring-unset')).toBe('')
  })

  it('returns empty for a blank effortLevel', () => {
    expect(readAgentEffort('effort-wiring-blank')).toBe('')
  })

  it('ignores a non-string effortLevel rather than coercing it', () => {
    expect(readAgentEffort('effort-wiring-nonstring')).toBe('')
  })

  it('returns empty, not throw, when agent-config.json is missing entirely', () => {
    expect(readAgentEffort('effort-wiring-nofile')).toBe('')
  })

  it('returns empty, not throw, for a nonexistent agent dir', () => {
    expect(readAgentEffort('effort-wiring-does-not-exist-at-all')).toBe('')
  })
})

// Structural lock, same shape as RESPAWNMODEL807's lock in
// main-model-resolution-parity.test.ts: pin that the local sub-agent launch
// command actually reads readAgentEffort(name) and wires it into an
// --effort flag on the SAME cmd string that carries --model, so a future
// edit cannot silently drop it again the way the original gap went
// unnoticed for the whole life of this launch path.
describe('startAgentProcess launch command wires effort (EFFORT806-B structural lock)', () => {
  const src = readFileSync(join(REPO_ROOT, 'src', 'web', 'agent-process.ts'), 'utf-8')

  it('imports readAgentEffort from agent-config.js', () => {
    expect(src).toMatch(/import\s*\{[^}]*\breadAgentEffort\b[^}]*\}\s*from\s*'\.\/agent-config\.js'/)
  })

  it('resolves effort via readAgentEffort(name) in the local (non-remote) launch path', () => {
    expect(src).toContain('const effort = readAgentEffort(name)')
  })

  it('the launch cmd template references an effort flag alongside --model', () => {
    // Locate the cmd template line that also carries --model (the local
    // sub-agent launch sink) and assert it also carries the effort flag
    // variable, not just the (potentially separate) remote/main sinks.
    const cmdLine = src.split('\n').find((l) => l.includes('${claudeBin()}') && l.includes('--model'))
    expect(cmdLine, 'local launch cmd template line not found').toBeDefined()
    expect(cmdLine).toMatch(/effortFlag/)
  })

  it('effortFlag is built from shSingleQuote(effort), matching the model-flag escaping pattern', () => {
    expect(src).toMatch(/effortFlag\s*=\s*effort \? `--effort \$\{shSingleQuote\(effort\)\}[^`]*`\s*:\s*''/)
  })
})

// Same structural lock for the SSH remote-agent launch path (ssh-tmux.ts),
// closed for consistency even though no agent is currently remote-configured
// -- see buildRemoteLaunchCommand's own comment for why this was included.
describe('startRemoteAgentProcess launch command wires effort (EFFORT806-B, remote path)', () => {
  const src = readFileSync(join(REPO_ROOT, 'src', 'web', 'agent-process.ts'), 'utf-8')
  const sshSrc = readFileSync(join(REPO_ROOT, 'src', 'web', 'ssh-tmux.ts'), 'utf-8')

  it('startRemoteAgentProcess passes effort: readAgentEffort(name) into buildRemoteLaunchCommand', () => {
    expect(src).toContain('const effort = readAgentEffort(name)')
    expect(src).toContain('buildRemoteLaunchCommand({ workdir, model, effort, continue: hasPriorSession })')
  })

  it('buildRemoteLaunchCommand emits --effort when given one', () => {
    expect(sshSrc).toMatch(/effortFlag\s*=\s*opts\.effort/)
  })
})
