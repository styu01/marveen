// Kanban cf12a93a (2026-09-02), Codex review round 3, independently
// confirmed by BÉLA reading the actual code: telegramHttpPost had NO
// timeout at all -- a stalled TCP connection (accepted, never responding)
// would leave the promise pending forever, since req.on('error') only
// fires on a genuine connection-level error. This matters now that
// owner-escalation.ts's retry loop AWAITs a Telegram send directly. This
// test mocks node:https directly (telegramHttpPost is not exported, and
// the URL is hardcoded to api.telegram.org, so a real hanging local server
// can't be substituted without a bigger refactor this fix doesn't need) to
// simulate exactly that hang, and proves the fix: req.setTimeout fires,
// destroys the request with a clear error, and that error reaches the
// caller as a rejection instead of an unresolved promise.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

class FakeRequest extends EventEmitter {
  written: string[] = []
  ended = false
  destroyed = false
  destroyError: Error | null = null
  timeoutMs: number | null = null
  timeoutCb: (() => void) | null = null

  setTimeout(ms: number, cb: () => void): this {
    this.timeoutMs = ms
    this.timeoutCb = cb
    return this
  }
  write(chunk: string): boolean {
    this.written.push(chunk)
    return true
  }
  end(): void {
    this.ended = true
  }
  destroy(err?: Error): this {
    this.destroyed = true
    this.destroyError = err ?? null
    if (err) this.emit('error', err)
    return this
  }
}

let lastReq: FakeRequest | null = null
const mockHttpsRequest = vi.fn((_url: string, _opts: unknown, _cb: (res: unknown) => void) => {
  lastReq = new FakeRequest()
  return lastReq
})

vi.mock('node:https', () => ({
  default: { request: (...a: Parameters<typeof mockHttpsRequest>) => mockHttpsRequest(...a) },
  request: (...a: Parameters<typeof mockHttpsRequest>) => mockHttpsRequest(...a),
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../test-run-marker.js', () => ({
  markIfTestRun: (t: string) => t,
}))

import { getProvider } from '../channel-provider.js'
import { TOOL_TIMEOUTS } from '../tool-timeouts.js'

describe('telegramHttpPost (via getProvider(telegram).sendMessage): timeout on a stalled connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastReq = null
  })

  it('registers a timeout using TOOL_TIMEOUTS.telegram (the same deadline sendTelegramMessage already uses)', async () => {
    const provider = getProvider('telegram')
    // Don't await -- the fake response callback never fires, so this would
    // hang forever without the timeout. We only need to inspect the request
    // object's registered timeout, not resolve the call.
    void provider.sendMessage('tok', 'chat', 'hello').catch(() => {})
    await Promise.resolve() // let the promise executor run synchronously

    expect(lastReq).not.toBeNull()
    expect(lastReq!.timeoutMs).toBe(TOOL_TIMEOUTS['telegram'])
  })

  it('a stalled connection (timeout fires) rejects instead of hanging forever', async () => {
    const provider = getProvider('telegram')
    const sendPromise = provider.sendMessage('tok', 'chat', 'hello')
    await Promise.resolve()

    expect(lastReq).not.toBeNull()
    expect(lastReq!.timeoutCb).not.toBeNull()

    // Simulate the timeout firing (what Node itself would do after
    // TOOL_TIMEOUTS['telegram'] ms of silence on the socket).
    lastReq!.timeoutCb!()

    await expect(sendPromise).rejects.toThrow(/timed out/)
    expect(lastReq!.destroyed).toBe(true)
  })

  it('a normal, timely 200 response still resolves normally (the fix does not break the success path)', async () => {
    let responseCb: ((res: unknown) => void) | null = null
    mockHttpsRequest.mockImplementationOnce((_url, _opts, cb) => {
      lastReq = new FakeRequest()
      responseCb = cb as (res: unknown) => void
      return lastReq
    })
    const provider = getProvider('telegram')
    const sendPromise = provider.sendMessage('tok', 'chat', 'hello')
    await Promise.resolve()

    responseCb!({ statusCode: 200, resume: () => {} })
    await expect(sendPromise).resolves.toBeUndefined()
  })
})
