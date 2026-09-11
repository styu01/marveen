import { describe, it, expect, beforeAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { initDatabase, createAgentMessage, markMessageDone } from '../db.js'
import { tryHandleMessages } from '../web/routes/messages.js'
import type { RouteContext } from '../web/routes/types.js'

// SUPHOX318-B (2026-09-11, kanban 4bf72b27): GET /api/messages/closure-debt
// exposes db.ts's getRepliedButUnclosedInboundMessages over HTTP -- the
// handoff skill only has curl/bash access, no direct DB access, same
// reasoning as waiting-outbound-route.test.ts's sibling route.

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

describe('GET /api/messages/closure-debt (runtime)', () => {
  it('requires the agent query parameter', async () => {
    const r = await get('/api/messages/closure-debt')
    expect(r.statusCode).toBe(400)
    expect(String((r.json as { error?: string })?.error)).toContain('agent')
  })

  it('returns an inbound dispatch the agent already replied to but never closed', async () => {
    const dispatch = createAgentMessage('cdr-a', 'cdr-exec', 'delegalt feladat')
    createAgentMessage('cdr-exec', 'cdr-a', 'vettem, kesz')
    const r = await get('/api/messages/closure-debt?agent=cdr-exec')
    expect(r.statusCode).toBe(200)
    const rows = r.json as { id: number; from_agent: string; created_at: number }[]
    const match = rows.find((row) => row.id === dispatch.id)
    expect(match).toBeDefined()
    expect(match?.from_agent).toBe('cdr-a')
  })

  it('excludes a dispatch with no reply yet', async () => {
    const dispatch = createAgentMessage('cdr-b', 'cdr-exec2', 'meg nyitott feladat')
    const r = await get('/api/messages/closure-debt?agent=cdr-exec2')
    const rows = r.json as { id: number }[]
    expect(rows.some((row) => row.id === dispatch.id)).toBe(false)
  })

  it('excludes a dispatch already closed (done/failed), even with a reply', async () => {
    const dispatch = createAgentMessage('cdr-c', 'cdr-exec3', 'harmadik feladat')
    createAgentMessage('cdr-exec3', 'cdr-c', 'kesz')
    markMessageDone(dispatch.id, 'lezarva')
    const r = await get('/api/messages/closure-debt?agent=cdr-exec3')
    const rows = r.json as { id: number }[]
    expect(rows.some((row) => row.id === dispatch.id)).toBe(false)
  })

  it('does NOT return the agent\'s own OUTBOUND dispatches (that is /waiting-outbound\'s job, not this route\'s)', async () => {
    const outbound = createAgentMessage('cdr-exec4', 'cdr-d', 'cdr-exec4 sajat kiadott feladata')
    createAgentMessage('cdr-d', 'cdr-exec4', 'cdr-d valaszol')
    const r = await get('/api/messages/closure-debt?agent=cdr-exec4')
    const rows = r.json as { id: number }[]
    expect(rows.some((row) => row.id === outbound.id)).toBe(false)
  })

  it('applies a valid explicit limit', async () => {
    for (let i = 0; i < 5; i++) {
      const d = createAgentMessage('cdr-e', 'cdr-exec5', `feladat ${i}`)
      createAgentMessage('cdr-exec5', 'cdr-e', `valasz ${i} a ${d.id}-re`)
    }
    const r = await get('/api/messages/closure-debt?agent=cdr-exec5&limit=2')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(2)
  })

  it('falls back to the default (10) for a non-numeric limit', async () => {
    for (let i = 0; i < 5; i++) {
      const d = createAgentMessage('cdr-f', 'cdr-exec6', `feladat ${i}`)
      createAgentMessage('cdr-exec6', 'cdr-f', `valasz ${i} a ${d.id}-re`)
    }
    const r = await get('/api/messages/closure-debt?agent=cdr-exec6&limit=not-a-number')
    expect(r.statusCode).toBe(200)
    expect((r.json as unknown[]).length).toBe(5)
  })
})
