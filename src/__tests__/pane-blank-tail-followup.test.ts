import { describe, it, expect } from 'vitest'
import { parkedPasteSignature, paneShowsContextSaturation } from '../pane-state.js'

// ED50E8B5 follow-up (found in Codex review of the upstream port of #1205/#1212,
// 2026-09-10): the blank-tail blindness those commits fixed for six read probes
// and for detectPaneState/shouldRetrySubmit's busy windows also applied to two
// functions neither upstream commit touched -- parkedPasteSignature's busy
// window and paneShowsContextSaturation's only window. Same shape, same fix
// (liveTailRegion), ported here rather than left as a latent gap.

const BLANK_TAIL = '\n'.repeat(18)

describe('parkedPasteSignature: spinner-only busy signal with a blank tail', () => {
  // Same fixture shape as pane-busy-blank-tail.test.ts's busyWithPlaceholder:
  // a live spinner above a pasted-text placeholder, footer WITHOUT
  // `esc to interrupt` (that combination is exactly what a raw
  // slice(-BUSY_LIVE_REGION_LINES) can miss once padded with a blank tail --
  // the second check, BUSY_ESC_TO_INTERRUPT_RX on the footer, would not have
  // caught it either).
  const busyWithPlaceholder = [
    '  Reading the sprint notes before the merge.',
    '',
    '✽ Brewing… (52s · ↓ 2.6k tokens)',
    '',
    '────────────────────────────────────────────────────────────────────────',
    '❯ [Pasted text #1 +214 lines]',
    '────────────────────────────────────────────────────────────────────────',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n')

  it('is parked (no live busy signal) once the spinner is removed -- control', () => {
    expect(parkedPasteSignature(busyWithPlaceholder.replace('✽ Brewing… (52s · ↓ 2.6k tokens)', '')))
      .toBe('❯ [Pasted text #1 +214 lines]')
  })

  it('is NOT parked while the spinner is live, with or without a blank tail', () => {
    expect(parkedPasteSignature(busyWithPlaceholder)).toBeNull()
    expect(parkedPasteSignature(busyWithPlaceholder + BLANK_TAIL)).toBeNull()
  })
})

describe('paneShowsContextSaturation with a blank tail below the banner', () => {
  const saturated = [
    '  Reading the sprint notes before the merge.',
    '',
    '  ⎿  100% context used',
    '────────────────────────────────────────────────────────────────────────',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n')

  it('is detected with the banner at the true tail -- control', () => {
    expect(paneShowsContextSaturation(saturated)).toBe(true)
  })

  it('is still detected once padded with a blank tail', () => {
    expect(paneShowsContextSaturation(saturated + BLANK_TAIL)).toBe(true)
  })

  it('stays false for an old saturation notice scrolled out of the live window', () => {
    const scrolledAway = [
      saturated,
      '',
      ...Array.from({ length: 20 }, (_, i) => `  step ${i + 1}: editing src/file${i}.ts`),
      '  Done. Three call sites updated.',
    ].join('\n')
    expect(paneShowsContextSaturation(scrolledAway)).toBe(false)
  })
})
