import { describe, it, expect, beforeAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { initDatabase, createAgentMessage, markMessageDone } from '../db.js'
import { tryHandleMessages } from '../web/routes/messages.js'
import type { RouteContext } from '../web/routes/types.js'

// SONWIN905 (2026-09-05, v3 plan section 5): GET /api/messages/waiting-outbound
// exposes db.ts's getWaitingOutboundMessages over HTTP -- the handoff skill
// only has curl/bash access, no direct DB access, same as every other data
// source it reads (kanban, hot/warm memory, daily log). Runtime tests, not
// just source-scanned: same reasoning as messages-post-sender-guards.test.ts.

function fakeGetCtx(path: string): { ctx: RouteContext; res: { statusCode: number; body: string } } {
  const req = new EventEmitter() as unknown as RouteContext['req']
  ;(req as unknown as { headers: Record<string, string> }).headers = {}
  const state = { statusCode: 0, body: '' }
  const res = {
    writeHead(code: number) { state.statusCode = code; return res },
    end(data?: unknown) { state.body = String(data ?? '') },
    setHeader() { /* not used by json() */ },
  } as unknown as RouteContext['res']
  const url = new URL(`http://localhost${path}`)
  return { ctx: { req, res, path: url.pathname, method: 'GET', url, fedPeer: null }, res: state }
}

async function get(path: string): Promise<{ statusCode: number; json: unknown }> {
  const { ctx, res } = fakeGetCtx(path)
  const handled = await tryHandleMessages(ctx)
  expect(handled).toBe(true)
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})

describe('GET /api/messages/waiting-outbound (runtime)', () => {
  it('requires the agent query parameter', async () => {
    const r = await get('/api/messages/waiting-outbound')
    expect(r.statusCode).toBe(400)
    expect(String((r.json as { error?: string })?.error)).toContain('agent')
  })

  it('returns the concrete pending/delivered outbound threads for that agent', async () => {
    const sent = createAgentMessage('route-wait-a', 'route-wait-b', 'delegalt feladat')
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-a')
    expect(r.statusCode).toBe(200)
    const rows = r.json as { id: number; to_agent: string; created_at: number }[]
    const match = rows.find((row) => row.id === sent.id)
    expect(match).toBeDefined()
    expect(match?.to_agent).toBe('route-wait-b')
  })

  it('excludes messages already closed (done/failed)', async () => {
    const done = createAgentMessage('route-wait-c', 'route-wait-b', 'ez mar kesz')
    markMessageDone(done.id, 'ok')
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-c')
    const rows = r.json as { id: number }[]
    expect(rows.some((row) => row.id === done.id)).toBe(false)
  })

  // Codex review (SONWIN905, 2026-09-05): our own CLAUDE.md's Level-1
  // autonomy pattern sends a self-addressed message (`bela -> bela
  // [FELHÍVÁS] ...`) as a fire-and-forget notification -- nobody ever marks
  // these done, so without this exclusion every agent using that pattern
  // would show a permanent, unresolvable "waiting on myself" thread.
  it('excludes self-addressed messages (from_agent = to_agent)', async () => {
    const self = createAgentMessage('route-wait-self', 'route-wait-self', '[FELHÍVÁS] level1 note to myself')
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-self')
    const rows = r.json as { id: number }[]
    expect(rows.some((row) => row.id === self.id)).toBe(false)
  })

  it('applies a valid explicit limit', async () => {
    for (let i = 0; i < 5; i++) {
      createAgentMessage('route-wait-d', 'route-wait-b', `uzenet ${i}`)
    }
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-d&limit=2')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(2)
  })

  it('falls back to the default (10) for a non-numeric limit, rather than erroring or returning zero rows', async () => {
    for (let i = 0; i < 5; i++) {
      createAgentMessage('route-wait-garbage', 'route-wait-b', `uzenet ${i}`)
    }
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-garbage&limit=not-a-number')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(5)
  })

  // Codex review (SONWIN905, 2026-09-05): an earlier draft's route-level
  // clamp treated limit=0 and a negative limit INCONSISTENTLY -- `0 || 10`
  // being falsy in JS silently defaulted a zero limit to 10, while a negative
  // limit instead clamped to a floor of 1 -- two different "invalid" values,
  // two different outcomes, from one line of ad-hoc arithmetic. Both must now
  // collapse to the SAME default (10), same treatment as a non-numeric limit.
  it('falls back to the default (10) for a zero limit (not to zero rows)', async () => {
    for (let i = 0; i < 5; i++) {
      createAgentMessage('route-wait-zero', 'route-wait-b', `uzenet ${i}`)
    }
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-zero&limit=0')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(5)
  })

  it('falls back to the default (10) for a negative limit (not to a floor of 1)', async () => {
    for (let i = 0; i < 5; i++) {
      createAgentMessage('route-wait-negative', 'route-wait-b', `uzenet ${i}`)
    }
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-negative&limit=-5')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(5)
  })

  it('clamps a limit above 50 down to 50', async () => {
    for (let i = 0; i < 55; i++) {
      createAgentMessage('route-wait-over', 'route-wait-b', `uzenet ${i}`)
    }
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-over&limit=200')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(50)
  })

  it('only returns messages FROM the given agent, not messages addressed TO it (mailbox vs outbound)', async () => {
    // route-wait-g sends to route-wait-h -- an INBOUND message for
    // route-wait-h, not something route-wait-h itself dispatched. Querying
    // ?agent=route-wait-h must not surface it.
    const inbound = createAgentMessage('route-wait-g', 'route-wait-h', 'route-wait-g uzeni route-wait-h-nak')
    const r = await get('/api/messages/waiting-outbound?agent=route-wait-h')
    const rows = r.json as { id: number }[]
    expect(rows.some((row) => row.id === inbound.id)).toBe(false)
  })
})
