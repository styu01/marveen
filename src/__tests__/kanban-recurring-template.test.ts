import { describe, it, expect, beforeEach } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, createKanbanCard, getKanbanCard, getKanbanRecurringTemplateEvents, hasBlockingKanbanCardForAssignee } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import type { RouteContext } from '../web/routes/types.js'

function fakeCtx(path: string, method: string, body: unknown, auth: RouteContext['auth']) {
  const out: { status?: number; body?: unknown } = {}
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage
  const res = { writeHead: (status: number) => { out.status = status }, end: (payload?: string) => { out.body = payload ? JSON.parse(payload) : undefined } } as unknown as http.ServerResponse
  return { ctx: { req, res, path, method, url: new URL(`http://localhost${path}`), auth } as RouteContext, out }
}

beforeEach(() => initDatabase(':memory:'))

describe('recurring Kanban templates', () => {
  it('migrates an existing board fail-safe to is_recurring_template=0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kanban-recurring-migration-'))
    const file = join(dir, 'legacy.db')
    const legacy = new Database(file)
    legacy.exec(`CREATE TABLE kanban_cards (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL CHECK(status IN ('planned','in_progress','testing','waiting','done')),
      assignee TEXT, priority TEXT NOT NULL, project TEXT, due_date INTEGER,
      sort_order REAL NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      archived_at INTEGER, parent_id TEXT, dispatched_at INTEGER
    )`)
    legacy.prepare(`INSERT INTO kanban_cards (id,title,status,assignee,priority,sort_order,created_at,updated_at) VALUES ('legacy','Existing work','in_progress','bela','normal',0,1,1)`).run()
    legacy.close()
    try {
      initDatabase(file)
      expect(getKanbanCard('legacy')?.is_recurring_template).toBe(0)
      expect(hasBlockingKanbanCardForAssignee('bela')).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('defaults cards to blocking and excludes only explicit recurring templates', () => {
    createKanbanCard({ id: 'recurring', title: 'Weekly container', status: 'in_progress', assignee: 'bela', is_recurring_template: true })
    expect(hasBlockingKanbanCardForAssignee('bela')).toBe(false)
    createKanbanCard({ id: 'run', title: 'This week run', status: 'in_progress', assignee: 'bela' })
    expect(getKanbanCard('run')?.is_recurring_template).toBe(0)
    expect(hasBlockingKanbanCardForAssignee('bela')).toBe(true)
  })

  // Istvan's explicit call (2026-09-23): no authorization is required to set
  // this flag -- any credential kind (including the shared bearer token every
  // sub-agent holds) can flip it. The gate that used to require an owner
  // browser session broke Istvan's own ability to edit cards in practice
  // (the edit form always resends this field), so it was removed entirely.
  it('accepts a bearer-token transition to true and records an audit event', async () => {
    createKanbanCard({ id: 'weekly', title: 'Weekly container', assignee: 'bela' })
    const { ctx, out } = fakeCtx('/api/kanban/weekly', 'PUT', { is_recurring_template: true }, { kind: 'token' })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(200)
    expect(getKanbanCard('weekly')?.is_recurring_template).toBe(1)
    expect(hasBlockingKanbanCardForAssignee('bela')).toBe(false)
    expect(getKanbanRecurringTemplateEvents('weekly')).toMatchObject([{ card_id: 'weekly', from_value: 0, to_value: 1, actor: 'shared-token' }])
  })

  it('accepts a session transition to true and records the session username as actor', async () => {
    createKanbanCard({ id: 'weekly2', title: 'Weekly container', assignee: 'bela' })
    const { ctx, out } = fakeCtx('/api/kanban/weekly2', 'PUT', { is_recurring_template: true }, { kind: 'session', user: 'styu01' })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(200)
    expect(getKanbanRecurringTemplateEvents('weekly2')).toMatchObject([{ card_id: 'weekly2', from_value: 0, to_value: 1, actor: 'styu01' }])
  })

  it('accepts creation of a recurring template by any credential', async () => {
    const { ctx, out } = fakeCtx('/api/kanban', 'POST', { title: 'Any caller can do this now', is_recurring_template: true }, { kind: 'token' })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(200)
  })

  it('does not record an audit event for a resend of the unchanged current value (the edit form always includes this field)', async () => {
    createKanbanCard({ id: 'untouched', title: 'Not a recurring template', assignee: 'bela' })
    const stillFalse = fakeCtx('/api/kanban/untouched', 'PUT', { title: 'Renamed by anyone', is_recurring_template: false }, { kind: 'token' })
    expect(await tryHandleKanban(stillFalse.ctx)).toBe(true)
    expect(stillFalse.out.status).toBe(200)
    expect(getKanbanCard('untouched')?.title).toBe('Renamed by anyone')
    expect(getKanbanCard('untouched')?.is_recurring_template).toBe(0)
    expect(getKanbanRecurringTemplateEvents('untouched')).toEqual([])

    createKanbanCard({ id: 'already-recurring', title: 'Weekly container', is_recurring_template: true })
    const stillTrue = fakeCtx('/api/kanban/already-recurring', 'PUT', { title: 'Renamed by anyone else', is_recurring_template: true }, { kind: 'token' })
    expect(await tryHandleKanban(stillTrue.ctx)).toBe(true)
    expect(stillTrue.out.status).toBe(200)
    expect(getKanbanCard('already-recurring')?.title).toBe('Renamed by anyone else')
    expect(getKanbanCard('already-recurring')?.is_recurring_template).toBe(1)
  })

  it('rejects truthy non-boolean values', async () => {
    createKanbanCard({ id: 'typed', title: 'Typed', assignee: 'bela' })
    const { ctx, out } = fakeCtx('/api/kanban/typed', 'PUT', { is_recurring_template: 'true' }, { kind: 'token' })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(400)
    expect(getKanbanCard('typed')?.is_recurring_template).toBe(0)
  })
})
