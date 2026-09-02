import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readFleetPauseState,
  shouldHoldForFleetPause,
  FLEET_PAUSE_PROTECTED_AGENTS,
  type FleetPauseState,
} from '../web/usage-fleet-pause.js'

// Kanban ff2ed32d, Codex review point #4: store/.usage-fleet-pause was
// written by usage-monitor but read by nothing. These tests cover the
// module that closes that gap -- see the module's own header comment for
// the full design rationale (why FELADAT: not a blanket block, why reads
// fail open, why exactly these three agents).

describe('readFleetPauseState', () => {
  let dir: string
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  function withFile(content: string | null): string {
    dir = mkdtempSync(join(tmpdir(), 'usage-fleet-pause-test-'))
    const path = join(dir, '.usage-fleet-pause')
    if (content !== null) writeFileSync(path, content)
    return path
  }

  it('missing file -> not paused', () => {
    dir = mkdtempSync(join(tmpdir(), 'usage-fleet-pause-test-'))
    const path = join(dir, 'does-not-exist')
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('empty file -> not paused (usage-monitor\'s own "cleared" convention)', () => {
    const path = withFile('')
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('whitespace-only file -> not paused', () => {
    const path = withFile('   \n  ')
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('valid JSON, paused true, full detail -> paused with fields', () => {
    const path = withFile(JSON.stringify({
      paused: true, metric: 'five_hour', percent: 91.2, source: 'authoritative_statusline', since: 1788300000,
    }))
    expect(readFleetPauseState(path)).toEqual({
      paused: true, metric: 'five_hour', percent: 91.2, source: 'authoritative_statusline', since: 1788300000,
    })
  })

  it('valid JSON, paused false -> not paused', () => {
    const path = withFile(JSON.stringify({ paused: false }))
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('old plain-text "paused" format (pre-2026-09-02) -> bare paused', () => {
    const path = withFile('paused')
    expect(readFleetPauseState(path)).toEqual({ paused: true })
  })

  it('old plain-text format with surrounding whitespace -> still recognized', () => {
    const path = withFile('  paused  \n')
    expect(readFleetPauseState(path)).toEqual({ paused: true })
  })

  it('malformed JSON -> fails open (not paused), does not throw', () => {
    const path = withFile('{not valid json')
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('valid JSON but not an object (e.g. a bare array) -> not paused', () => {
    const path = withFile('[1,2,3]')
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('valid JSON object missing "paused" key -> not paused', () => {
    const path = withFile(JSON.stringify({ metric: 'five_hour', percent: 91 }))
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('paused key present but not literally true (e.g. string "true") -> not paused', () => {
    const path = withFile(JSON.stringify({ paused: 'true' }))
    expect(readFleetPauseState(path)).toEqual({ paused: false })
  })

  it('ignores non-string/non-number detail fields rather than propagating wrong types', () => {
    const path = withFile(JSON.stringify({ paused: true, metric: 123, percent: '91', source: null, since: 'now' }))
    expect(readFleetPauseState(path)).toEqual({ paused: true })
  })
})

describe('shouldHoldForFleetPause', () => {
  const paused: FleetPauseState = { paused: true, metric: 'five_hour', percent: 91 }
  const notPaused: FleetPauseState = { paused: false }

  it('holds a FELADAT: delegation to a protected agent while paused', () => {
    expect(shouldHoldForFleetPause('progi', 'FELADAT:\n\nBuild X', paused)).toBe(true)
  })

  it('does not hold when not paused', () => {
    expect(shouldHoldForFleetPause('progi', 'FELADAT:\n\nBuild X', notPaused)).toBe(false)
  })

  it('does not hold a non-FELADAT message even while paused (replies, coordination stay flowing)', () => {
    expect(shouldHoldForFleetPause('progi', 'Quick question about the last task', paused)).toBe(false)
  })

  it('does not hold the pause/unpause control messages themselves (no FELADAT: marker) -- the chicken-and-egg case', () => {
    expect(shouldHoldForFleetPause('progi', 'MEGOSZTOTT USAGE >=90% (five_hour 91%). NE indits UJ munkat...', paused)).toBe(false)
    expect(shouldHoldForFleetPause('progi', 'Usage limit feloldva (five_hour 42%, seven_day 5%), folytathatjatok uj munkat.', paused)).toBe(false)
  })

  it('does not hold delegations to an unprotected agent (e.g. vizsla, bela) even while paused', () => {
    expect(shouldHoldForFleetPause('vizsla', 'FELADAT:\n\nRead this page', paused)).toBe(false)
    expect(shouldHoldForFleetPause('bela', 'FELADAT:\n\nSomething', paused)).toBe(false)
  })

  it('tolerates leading whitespace before the marker', () => {
    expect(shouldHoldForFleetPause('okoska', '  \nFELADAT:\n\nWrite copy', paused)).toBe(true)
  })

  it('requires an exact marker match, not a substring elsewhere in the content', () => {
    expect(shouldHoldForFleetPause('iris', 'Please see the FELADAT: reference below for context', paused)).toBe(false)
  })

  it('FLEET_PAUSE_PROTECTED_AGENTS is exactly progi/okoska/iris', () => {
    expect(Array.from(FLEET_PAUSE_PROTECTED_AGENTS).sort()).toEqual(['iris', 'okoska', 'progi'])
  })
})
