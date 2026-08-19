import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordSentText,
  isKnownRecentInjection,
  SENT_TEXT_TTL_MS,
  _resetSentTextRegistryForTests,
} from '../web/sent-text-registry.js'

// Root cause (measured 2026-08-19): a long injected prompt gets collapsed to
// one line and typed via chunked send-keys; when it overflows the TUI's
// input-box view, the box auto-scrolls in place -- the missing opening text
// was never painted to a terminal row that persists, so no amount of
// capture-pane scrollback recovers it. This module is the fallback: it
// tracks what sendPromptToSession() actually sent, so a LATER fragment of
// that text can still be recognised as machine-origin.

describe('sent-text-registry', () => {
  beforeEach(() => {
    _resetSentTextRegistryForTests()
  })

  it('returns false when nothing has been recorded for the session', () => {
    expect(isKnownRecentInjection('bela-channels', 'anything')).toBe(false)
  })

  it('recognises a fragment that is a substring of the recorded text', () => {
    recordSentText('bela-channels', 'SCHEDULED TASK NOTICE -- the next <scheduled-task source="...">')
    // A later, scrolled-into-view fragment of the same long line.
    expect(isKnownRecentInjection('bela-channels', 'the next <scheduled-task source="...">')).toBe(true)
  })

  it('collapses whitespace on both sides before comparing (terminal soft-wrap)', () => {
    recordSentText('bela-channels', 'SCHEDULED   TASK\nNOTICE -- the next  <scheduled-task')
    expect(isKnownRecentInjection('bela-channels', '  TASK\n\nNOTICE  -- the   next')).toBe(true)
  })

  it('does not match unrelated text', () => {
    recordSentText('bela-channels', 'SCHEDULED TASK NOTICE -- the next <scheduled-task source="...">')
    expect(isKnownRecentInjection('bela-channels', 'a completely unrelated human draft')).toBe(false)
  })

  it('rejects an empty visible fragment', () => {
    recordSentText('bela-channels', 'SCHEDULED TASK NOTICE')
    expect(isKnownRecentInjection('bela-channels', '   ')).toBe(false)
  })

  it('expires after SENT_TEXT_TTL_MS', () => {
    const t0 = 1_000_000
    recordSentText('bela-channels', 'SCHEDULED TASK NOTICE -- the next', t0)
    expect(isKnownRecentInjection('bela-channels', 'the next', t0 + SENT_TEXT_TTL_MS - 1)).toBe(true)
    expect(isKnownRecentInjection('bela-channels', 'the next', t0 + SENT_TEXT_TTL_MS + 1)).toBe(false)
  })

  it('keeps per-session state separate', () => {
    recordSentText('bela-channels', 'SCHEDULED TASK NOTICE for main')
    recordSentText('agent-progi', 'TEAM MEMBER NOTICE for progi')
    expect(isKnownRecentInjection('bela-channels', 'for progi')).toBe(false)
    expect(isKnownRecentInjection('agent-progi', 'for progi')).toBe(true)
    expect(isKnownRecentInjection('agent-progi', 'for main')).toBe(false)
  })

  it('a later send for the same session overwrites the earlier one', () => {
    recordSentText('bela-channels', 'first message body')
    recordSentText('bela-channels', 'second message body')
    expect(isKnownRecentInjection('bela-channels', 'first message body')).toBe(false)
    expect(isKnownRecentInjection('bela-channels', 'second message body')).toBe(true)
  })
})
