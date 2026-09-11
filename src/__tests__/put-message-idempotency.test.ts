import { describe, it, expect, beforeAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { initDatabase, createAgentMessage, listAgentMessages, getAgentMessage } from '../db.js'
import { tryHandleMessages, isTrivialClosureAck } from '../web/routes/messages.js'
import type { RouteContext } from '../web/routes/types.js'
import { MAIN_AGENT_ID } from '../config.js'

// Runtime tests for PUT /api/messages/:id -- kanban 4bf72b27/bcbf4511
// (2026-09-11, Codex-reviewed twice before this implementation):
//   1. Idempotent terminal-state guard: a repeat PUT on an already-closed
//      message is a no-op (alreadyTerminal:true), no second reverse
//      [Eredmény] notification.
//   2. isTrivialClosureAck-based notification suppression: closing a plain,
//      content-free ack does not fire a new [Eredmény] (the actual mechanism
//      behind the documented msg 1183-1201 ping-pong -- the existing
//      [Eredmény]-prefix guard alone did NOT cover this case).
//   3. Explicit, strictly-boolean `silent` PUT param as a caller-controlled
//      alternative that suppresses ONLY the notification, nothing else.
//
// Same req/res double pattern as messages-post-sender-guards.test.ts /
// waiting-outbound-route.test.ts: readBody consumes data/end via
// process.nextTick, json() uses writeHead/end.

function fakePutCtx(id: number, body: unknown): { ctx: RouteContext; res: { statusCode: number; body: string } } {
  const req = new EventEmitter() as unknown as RouteContext['req'] & { destroy(): void }
  ;(req as unknown as { headers: Record<string, string> }).headers = {}
  ;(req as { destroy(): void }).destroy = () => { /* readBody over-limit hook */ }
  const state = { statusCode: 0, body: '' }
  const res = {
    writeHead(code: number) { state.statusCode = code; return res },
    end(data?: unknown) { state.body = String(data ?? '') },
    setHeader() { /* not used by json() */ },
  } as unknown as RouteContext['res']
  process.nextTick(() => {
    ;(req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)))
    ;(req as unknown as EventEmitter).emit('end')
  })
  const path = `/api/messages/${id}`
  return { ctx: { req, res, path, method: 'PUT', url: new URL(`http://localhost${path}`), fedPeer: null }, res: state }
}

async function put(id: number, body: unknown): Promise<{ statusCode: number; json: unknown }> {
  const { ctx, res } = fakePutCtx(id, body)
  const handled = await tryHandleMessages(ctx)
  expect(handled).toBe(true)
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})

describe('isTrivialClosureAck (unit)', () => {
  it('matches exact, case-insensitive closing acks with optional trailing punctuation', () => {
    for (const s of ['ok', 'Ok', 'OK.', 'oké', 'Oké.', 'oke', 'Oke!', 'rendben', 'Rendben.', 'RENDBEN!',
      'köszönöm', 'Köszönöm.', 'koszonom', 'Koszonom.', 'köszi', 'Köszi!', 'koszi', 'Koszi.',
      'vettem', 'Vettem.', 'nyugtázva', 'Nyugtázva.', 'nyugtazva', 'Nyugtazva.', '  rendben  ']) {
      expect(isTrivialClosureAck(s), s).toBe(true)
    }
  })

  it('does NOT match a substantive reply that merely starts with an ack word', () => {
    for (const s of ['Rendben, de meg ellenőrzöm X-et is', 'ok, majd holnap', 'köszönöm a segítséget']) {
      expect(isTrivialClosureAck(s), s).toBe(false)
    }
  })

  it('does NOT match unrelated short words (not a closure-ack list, e.g. greetings/yes-no)', () => {
    for (const s of ['szia', 'hello', 'igen', 'nem', 'Rendben de']) {
      expect(isTrivialClosureAck(s), s).toBe(false)
    }
  })
})

// The notification-creation tests below invoke shouldNotifyDelegator via the
// REAL route, so the closed message's from_agent must be a REAL known agent
// (isKnownAgent(fromAgent) is one of the route's own gates) -- MAIN_AGENT_ID
// is the one identity isKnownAgent always accepts regardless of directory
// state, same reasoning already documented in completion-notification.test.ts's
// shouldNotifyDelegator block. Using an invented name here would make a
// "does still notify" assertion pass for the WRONG reason (isKnownAgent
// silently vetoing it, not the code path actually under test).
describe('PUT /api/messages/:id -- idempotent terminal-state guard (runtime)', () => {
  it('first close succeeds and notifies; repeat close is a no-op with alreadyTerminal:true, no second notification', async () => {
    const msg = createAgentMessage(MAIN_AGENT_ID, 'idem-b', 'valodi feladat')
    const before = listAgentMessages(200).length

    const first = await put(msg.id, { status: 'done', result: 'kesz' })
    expect(first.statusCode).toBe(200)
    expect(first.json).toEqual({ ok: true })
    const afterFirst = listAgentMessages(200).length
    expect(afterFirst - before).toBe(1) // exactly one reverse [Eredmény] created

    const second = await put(msg.id, { status: 'done', result: 'kesz megint' })
    expect(second.statusCode).toBe(200)
    expect(second.json).toEqual({ ok: true, alreadyTerminal: true })
    const afterSecond = listAgentMessages(200).length
    expect(afterSecond).toBe(afterFirst) // no new message created on repeat close
  })

  it('repeat close via failed after an earlier done is also a no-op (does not flip status backwards, original result untouched)', async () => {
    const msg = createAgentMessage(MAIN_AGENT_ID, 'idem-d', 'masik feladat')
    const first = await put(msg.id, { status: 'done', result: 'kesz' })
    expect(first.json).toEqual({ ok: true })

    const second = await put(msg.id, { status: 'failed', result: 'utolagos hiba' })
    expect(second.json).toEqual({ ok: true, alreadyTerminal: true })

    // The repeat "failed" attempt must not have flipped status or overwritten
    // the original result -- this is the whole point of the guard.
    const row = getAgentMessage(msg.id)!
    expect(row.status).toBe('done')
    expect(row.result).toBe('kesz')
  })

  it('a genuinely unknown id still 404s (alreadyTerminal path does not swallow real not-found)', async () => {
    const r = await put(999999, { status: 'done' })
    expect(r.statusCode).toBe(404)
  })

  // TOCTOU (2026-09-11, Codex review): the precheck and the guarded UPDATE
  // are two separate steps, so two PUTs racing on the SAME id can both see
  // pending/delivered at precheck time -- the loser's guarded UPDATE then
  // correctly affects 0 rows. Without the post-failure recheck this fell
  // through to a generic 404 for a message that in fact got closed fine (by
  // the winner). Fired via Promise.all so the two calls' async readBody/JSON
  // steps genuinely interleave on the event loop, not asserting a specific
  // winner (non-deterministic which one wins) but asserting the INVARIANT
  // that must hold regardless of interleaving: neither response is 404,
  // exactly one reverse notification was created (not zero, not two), and
  // the row ends up in a real terminal state.
  it('two concurrent PUTs on the same id never 404 and never double-notify', async () => {
    const msg = createAgentMessage(MAIN_AGENT_ID, 'idem-race', 'versenyfeladat')
    const before = listAgentMessages(200).length

    const [a, b] = await Promise.all([
      put(msg.id, { status: 'done', result: 'A nyert' }),
      put(msg.id, { status: 'done', result: 'B nyert' }),
    ])

    expect(a.statusCode).not.toBe(404)
    expect(b.statusCode).not.toBe(404)
    // Exactly one of the two is the "real" close; the other is alreadyTerminal.
    const results = [a.json, b.json] as Array<{ ok: boolean; alreadyTerminal?: boolean }>
    const realCloses = results.filter(r => r.ok && !r.alreadyTerminal)
    const noops = results.filter(r => r.ok && r.alreadyTerminal === true)
    expect(realCloses.length).toBe(1)
    expect(noops.length).toBe(1)

    const after = listAgentMessages(200).length
    expect(after - before).toBe(1) // exactly one reverse [Eredmény], never zero or two

    const row = getAgentMessage(msg.id)!
    expect(row.status).toBe('done')
  })
})

describe('PUT /api/messages/:id -- trivial closure-ack suppression (runtime)', () => {
  it('closing a plain, content-free ack ("Rendben.") does NOT create a reverse [Eredmény]', async () => {
    const ack = createAgentMessage(MAIN_AGENT_ID, 'bela-like', 'Rendben.')
    const before = listAgentMessages(200).length
    const r = await put(ack.id, { status: 'done' })
    expect(r.json).toEqual({ ok: true })
    const after = listAgentMessages(200).length
    expect(after).toBe(before) // no notification -- this is the ping-pong break
  })

  it('closing a reply that merely STARTS with an ack word but has real content DOES still notify', async () => {
    const real = createAgentMessage(MAIN_AGENT_ID, 'bela-like2', 'Rendben, de meg ellenőrzöm X-et is')
    const before = listAgentMessages(200).length
    const r = await put(real.id, { status: 'done' })
    expect(r.json).toEqual({ ok: true })
    const after = listAgentMessages(200).length
    expect(after - before).toBe(1)
  })
})

describe('PUT /api/messages/:id -- explicit silent param (runtime)', () => {
  it('silent:true suppresses ONLY the notification -- status/result/delivered_at all still update normally', async () => {
    const msg = createAgentMessage(MAIN_AGENT_ID, 'sil-b', 'batch lezaras')
    const before = listAgentMessages(200).length
    const r = await put(msg.id, { status: 'done', result: 'batch kesz', silent: true })
    expect(r.json).toEqual({ ok: true })
    const after = listAgentMessages(200).length
    expect(after).toBe(before) // no reverse notification

    // The properties silent:true explicitly promises to leave alone.
    const row = getAgentMessage(msg.id)!
    expect(row.status).toBe('done')
    expect(row.result).toBe('batch kesz')
    expect(row.delivered_at).not.toBeNull()
    expect(row.completed_at).not.toBeNull()
  })

  it('silent as a non-boolean (truthy string) is rejected with 400, message left untouched', async () => {
    const msg = createAgentMessage(MAIN_AGENT_ID, 'sil-d', 'harmadik feladat')
    const r = await put(msg.id, { status: 'done', silent: 'true' })
    expect(r.statusCode).toBe(400)
    // A second, valid close must still work normally (row was never touched).
    const retry = await put(msg.id, { status: 'done', result: 'most mar rendesen' })
    expect(retry.json).toEqual({ ok: true })
  })

  it('silent:false behaves exactly like omitting it (still notifies)', async () => {
    const msg = createAgentMessage(MAIN_AGENT_ID, 'sil-f', 'negyedik feladat')
    const before = listAgentMessages(200).length
    const r = await put(msg.id, { status: 'done', result: 'kesz', silent: false })
    expect(r.json).toEqual({ ok: true })
    const after = listAgentMessages(200).length
    expect(after - before).toBe(1)
  })
})
