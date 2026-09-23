import { describe, it, expect, beforeEach } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDatabase, createKanbanCard, createDashboardUser, getKanbanCard, getKanbanRecurringTemplateEvents, hasBlockingKanbanCardForAssignee } from '../db.js'
import { tryHandleKanban, mayManageRecurringTemplate } from '../web/routes/kanban.js'
import type { RouteContext } from '../web/routes/types.js'

const OWNER_USERNAME = 'styu01'

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

  it('rejects a regular bearer-token API update and leaves work blocking', async () => {
    createKanbanCard({ id: 'safe', title: 'Must remain blocking', assignee: 'bela' })
    const { ctx, out } = fakeCtx('/api/kanban/safe', 'PUT', { is_recurring_template: true }, { kind: 'token' })
    expect(await tryHandleKanban(ctx)).toBe(true)
    expect(out.status).toBe(403)
    expect(getKanbanCard('safe')?.is_recurring_template).toBe(0)
    expect(hasBlockingKanbanCardForAssignee('bela')).toBe(true)
  })

  it('rejects bearer-token creation of a recurring template', async () => {
    const { ctx, out } = fakeCtx('/api/kanban', 'POST', { title: 'Unauthorised', is_recurring_template: true }, { kind: 'token' })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(403)
  })

  it('rejects device/federation credentials and a non-owner session', () => {
    createDashboardUser(OWNER_USERNAME, 'not-used-in-this-db-test')
    expect(mayManageRecurringTemplate({ kind: 'device', device: OWNER_USERNAME })).toBe(false)
    expect(mayManageRecurringTemplate({ kind: 'federation', peer: OWNER_USERNAME })).toBe(false)
    expect(mayManageRecurringTemplate({ kind: 'session', user: 'somebody-else' })).toBe(false)
  })

  it('accepts only the owner browser session and records an audit event', async () => {
    createDashboardUser(OWNER_USERNAME, 'not-used-in-this-db-test')
    createKanbanCard({ id: 'weekly', title: 'Weekly container', assignee: 'bela' })
    const actor = OWNER_USERNAME.toUpperCase()
    const { ctx, out } = fakeCtx('/api/kanban/weekly', 'PUT', { is_recurring_template: true }, { kind: 'session', user: actor })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(200)
    expect(getKanbanCard('weekly')?.is_recurring_template).toBe(1)
    expect(hasBlockingKanbanCardForAssignee('bela')).toBe(false)
    expect(getKanbanRecurringTemplateEvents('weekly')).toMatchObject([{ card_id: 'weekly', from_value: 0, to_value: 1, actor }])
  })

  it('rejects truthy non-boolean values', async () => {
    createDashboardUser(OWNER_USERNAME, 'not-used-in-this-db-test')
    createKanbanCard({ id: 'typed', title: 'Typed', assignee: 'bela' })
    const { ctx, out } = fakeCtx('/api/kanban/typed', 'PUT', { is_recurring_template: 'true' }, { kind: 'session', user: OWNER_USERNAME })
    await tryHandleKanban(ctx)
    expect(out.status).toBe(400)
    expect(getKanbanCard('typed')?.is_recurring_template).toBe(0)
  })
})
