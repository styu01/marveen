import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { readConfiguredMainEffort, buildMainSessionRespawnCmd } from '../web/channel-monitor.js'
import { shSingleQuote } from '../web/agent-process.js'

// Effort counterpart of main-model-resolution-parity.test.ts.
//
// The main agent's reasoning effort is resolved by TWO independent
// implementations:
//
//   LAUNCH   scripts/channels.sh        resolve_main_effort()        (shell)
//   RESPAWN  src/web/channel-monitor.ts readConfiguredMainEffort()   (TS)
//
// They must agree, for the same reason model's two resolvers must agree
// (main-model-resolution-parity.test.ts): a silent disagreement means the
// agent boots at the configured effort and comes back at the CLI's default
// after any recovery respawn, with no error and no log line.
//
// EFFORT806-B (2026-09-03): until this fix, the RESPAWN side did not exist
// at all -- da4c801 (EFFORT806) built ONLY the shell resolver and wired it
// into channels.sh's two launch lines. Confirmed live during KISPROGI's
// 2026-09-02 audit: the actual running bela-channels process was a respawn
// (not the post-commit service restart) and its real /proc/<pid>/cmdline had
// --model but no --effort, despite settings.json's "effort": "high".
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const CHANNELS_SH = join(REPO_ROOT, 'scripts', 'channels.sh')

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

function fixture(envBody: string | null, settingsBody: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'maineffort-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, '.claude'), { recursive: true })
  copyFileSync(CHANNELS_SH, join(root, 'scripts', 'channels.sh'))
  if (envBody !== null) writeFileSync(join(root, '.env'), envBody + '\n')
  if (settingsBody !== null) writeFileSync(join(root, '.claude', 'settings.json'), settingsBody + '\n')
  return root
}

/** The shell answer, via the script's own side-effect-free test seam. */
function shellResolves(root: string): string {
  return execFileSync('bash', [join(root, 'scripts', 'channels.sh'), '--resolve-main-effort'], {
    encoding: 'utf-8',
  })
    .split('\n')[0]
    .trim()
}

// label, .env body, settings.json body, expected effort
const CASES: Array<[string, string | null, string | null, string]> = [
  ['settings.json alone is honoured', null, '{"effort":"high"}', 'high'],
  ['.env wins over settings.json (the whole point)', 'MAIN_AGENT_EFFORT=xhigh', '{"effort":"high"}', 'xhigh'],
  ['.env alone works with no settings.json', 'MAIN_AGENT_EFFORT=max', null, 'max'],
  // UNLIKE model: neither present means EMPTY on both sides, not a shipped
  // default -- effort has no distribution-default layer (da4c801's own
  // stated reasoning: an unset value legitimately omits the flag).
  ['neither present -> empty on both sides (no distribution default, unlike model)', null, null, ''],
  ['an EMPTY MAIN_AGENT_EFFORT does not shadow settings.json', 'MAIN_AGENT_EFFORT=', '{"effort":"high"}', 'high'],
  ['a similarly named key does not leak in', 'NOT_MAIN_AGENT_EFFORT=wrong', '{"effort":"high"}', 'high'],
  ['settings.json without an effort key resolves to empty', null, '{"enabledPlugins":{}}', ''],
]

describe('main-agent effort resolution: launch and respawn agree', () => {
  it.each(CASES)('%s', (_label, envBody, settingsBody, want) => {
    const root = fixture(envBody, settingsBody)
    const fromShell = shellResolves(root)
    const fromTs = readConfiguredMainEffort(root)

    expect(fromShell).toBe(want)
    expect(fromTs).toBe(want)
    expect(fromTs).toBe(fromShell)
  })
})

// EFFORT806-B structural lock, mirroring RESPAWNMODEL807's lock for model:
// every buildMainSessionRespawnCmd call site must pass effort too, or a
// future edit re-opens exactly the gap this fix closed.
describe('every respawn path asks the one effort resolver (EFFORT806-B)', () => {
  it('every buildMainSessionRespawnCmd call site passes effort: readConfiguredMainEffort()', () => {
    const src = readFileSync(join(REPO_ROOT, 'src', 'web', 'channel-monitor.ts'), 'utf-8')
    const sites = src.split('= buildMainSessionRespawnCmd({').length - 1
    const wired = src.split('effort: readConfiguredMainEffort()').length - 1
    expect(sites).toBeGreaterThanOrEqual(3)
    expect(wired).toBe(sites)
  })

  const OPTS = { claudePath: 'claude', pluginId: 'telegram', continueSession: false }

  it('buildMainSessionRespawnCmd emits --effort when given one', () => {
    const cmd = buildMainSessionRespawnCmd({ ...OPTS, model: 'claude-sonnet-5', effort: 'high' })
    expect(cmd).toContain("--effort 'high'")
    // --effort must come AFTER --model, mirroring MODEL_FLAG/EFFORT_FLAG order
    // in scripts/channels.sh, and BEFORE --channels.
    expect(cmd.indexOf('--model')).toBeLessThan(cmd.indexOf('--effort'))
    expect(cmd.indexOf('--effort')).toBeLessThan(cmd.indexOf('--channels'))
  })

  it('omits --effort entirely when not given (undefined) or empty', () => {
    expect(buildMainSessionRespawnCmd({ ...OPTS, model: 'claude-sonnet-5' })).not.toContain('--effort')
    expect(buildMainSessionRespawnCmd({ ...OPTS, model: 'claude-sonnet-5', effort: '' })).not.toContain('--effort')
  })

  // Same sink-escaping requirement as model-id-injection.test.ts holds for
  // --effort: it comes from the SAME two untrusted-ish sources (.env,
  // .claude/settings.json) as --model, so it needs the same belt (this repo
  // has no allowlist for effort values, unlike model) -- the escape at the
  // sink is the only guard on this path.
  it('single-quote-escapes a hostile effort value at the sink, running nothing', () => {
    const hostile = "y'; echo LEAKED_$(id -u); printf '"
    const cmd = buildMainSessionRespawnCmd({ ...OPTS, model: 'claude-sonnet-5', effort: hostile })
    const token = shSingleQuote(hostile)
    expect(cmd).toContain(`--effort ${token}`)
    const out = execFileSync('/bin/sh', ['-c', `printf %s ${token}`], { encoding: 'utf8' })
    expect(out).toBe(hostile)
  })
})
