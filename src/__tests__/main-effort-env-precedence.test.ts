// Effort counterpart of main-model-env-precedence.test.ts.
//
// Background (2026-09-02/03, EFFORT806-B): da4c801 wired --effort into
// scripts/channels.sh's cold-boot launch path (resolve_main_effort()) but the
// RESPAWN path (readConfiguredMainEffort() here) did not exist at all until
// this fix -- every recovery/soft-resume respawn of the main agent silently
// dropped back to the CLI's own default effort regardless of
// .claude/settings.json's "effort" key. Found live during KISPROGI's
// 2026-09-02 audit: the actual running bela-channels process (a respawn, not
// the post-commit service restart) had --model but no --effort in its real
// /proc/<pid>/cmdline.
//
// Same precedence contract as readConfiguredMainModel: .env MAIN_AGENT_EFFORT
// (per-install, gitignored) wins over .claude/settings.json's "effort" key
// (tracked). UNLIKE model, there is no distribution-default third layer --
// an unset value legitimately means "omit the flag, let the CLI use its own
// default" (da4c801's own stated reasoning, mirrored here rather than
// inventing a registry-style fallback that doesn't exist for effort).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readConfiguredMainEffort } from '../web/channel-monitor.js'

let root: string

function writeEnv(contents: string): void {
  writeFileSync(join(root, '.env'), contents)
}

function writeSettings(obj: unknown): void {
  mkdirSync(join(root, '.claude'), { recursive: true })
  writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(obj, null, 2))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'main-effort-precedence-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readConfiguredMainEffort', () => {
  it('prefers .env MAIN_AGENT_EFFORT over the tracked .claude/settings.json', () => {
    writeEnv('SOMETHING_ELSE=1\nMAIN_AGENT_EFFORT=xhigh\n')
    writeSettings({ effort: 'high' })
    expect(readConfiguredMainEffort(root)).toBe('xhigh')
  })

  it('falls back to settings.json when .env has no MAIN_AGENT_EFFORT', () => {
    writeEnv('CHANNEL_PLUGINS_EXTRA=slack-channel@marveen-marketplace\n')
    writeSettings({ effort: 'high' })
    expect(readConfiguredMainEffort(root)).toBe('high')
  })

  it('falls back to settings.json when .env is absent entirely', () => {
    writeSettings({ effort: 'high' })
    expect(readConfiguredMainEffort(root)).toBe('high')
  })

  // An EMPTY value must not win: `MAIN_AGENT_EFFORT=` is how a half-edited
  // .env looks, and treating it as a real answer would drop the --effort
  // flag even though settings.json has a real value.
  it('ignores an empty MAIN_AGENT_EFFORT and falls through', () => {
    writeEnv('MAIN_AGENT_EFFORT=\n')
    writeSettings({ effort: 'high' })
    expect(readConfiguredMainEffort(root)).toBe('high')
  })

  // UNLIKE model: no distribution-default layer exists for effort. Absent
  // from both sources must return '' (the caller omits --effort), not any
  // invented value -- this is the deliberate contract, not a gap to close.
  it('returns empty when neither source names an effort (no invented default, unlike model)', () => {
    writeEnv('MAIN_AGENT_EFFORT_SOMETHINGELSE=x\n')
    writeSettings({ enabledPlugins: {} })
    expect(readConfiguredMainEffort(root)).toBe('')
  })

  it('returns empty when neither .env nor settings.json exist at all', () => {
    expect(readConfiguredMainEffort(root)).toBe('')
  })

  it('survives an unparseable settings.json', () => {
    writeEnv('MAIN_AGENT_EFFORT=high\n')
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude', 'settings.json'), '{ not json')
    expect(readConfiguredMainEffort(root)).toBe('high')
  })

  it('a similarly named key does not leak in', () => {
    writeEnv('NOT_MAIN_AGENT_EFFORT=wrong\n')
    writeSettings({ effort: 'high' })
    expect(readConfiguredMainEffort(root)).toBe('high')
  })

  it('a non-string effort value in settings.json is ignored, not coerced', () => {
    writeSettings({ effort: 42 })
    expect(readConfiguredMainEffort(root)).toBe('')
  })
})
