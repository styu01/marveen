import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDashboardUser, getDb, initDatabase, isDashboardUserOwner } from '../db.js'
import { mayManageRecurringTemplate } from '../web/routes/kanban.js'

beforeEach(() => initDatabase(':memory:'))

describe('recurring template owner authority', () => {
  it('migrates legacy users by nominating exactly the earliest user, never all users', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dashboard-owner-migration-'))
    const file = join(dir, 'legacy.db')
    const legacy = new Database(file)
    legacy.exec(`CREATE TABLE dashboard_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0
    )`)
    legacy.prepare('INSERT INTO dashboard_users (username,password_hash,created_at,updated_at) VALUES (?,?,?,?)').run('styu01', 'hash', 1, 1)
    legacy.prepare('INSERT INTO dashboard_users (username,password_hash,created_at,updated_at) VALUES (?,?,?,?)').run('second-user', 'hash', 2, 2)
    legacy.close()
    try {
      initDatabase(file)
      expect(getDb().prepare('SELECT username, is_owner FROM dashboard_users ORDER BY id').all())
        .toEqual([{ username: 'styu01', is_owner: 1 }, { username: 'second-user', is_owner: 0 }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('accepts the realistic existing owner session username (styu01), not OWNER_NAME', () => {
    createDashboardUser('styu01', 'not-used-in-this-db-test')

    expect(isDashboardUserOwner('styu01')).toBe(true)
    expect(mayManageRecurringTemplate({ kind: 'session', user: 'styu01' })).toBe(true)
  })

  it('rejects a second, non-owner dashboard session', () => {
    createDashboardUser('styu01', 'not-used-in-this-db-test')
    createDashboardUser('second-user', 'not-used-in-this-db-test')

    expect(isDashboardUserOwner('styu01')).toBe(true)
    expect(isDashboardUserOwner('second-user')).toBe(false)
    expect(mayManageRecurringTemplate({ kind: 'session', user: 'second-user' })).toBe(false)
  })

  it('rejects a disabled owner and every non-session credential', () => {
    createDashboardUser('styu01', 'not-used-in-this-db-test')
    getDb().prepare("UPDATE dashboard_users SET disabled=1 WHERE username='styu01'").run()

    expect(mayManageRecurringTemplate({ kind: 'session', user: 'styu01' })).toBe(false)
    expect(mayManageRecurringTemplate({ kind: 'token' })).toBe(false)
    expect(mayManageRecurringTemplate({ kind: 'device', device: 'phone' })).toBe(false)
    expect(mayManageRecurringTemplate({ kind: 'federation', peer: 'bela' })).toBe(false)
  })
})
