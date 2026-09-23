import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDb, initDatabase } from '../db.js'

beforeEach(() => initDatabase(':memory:'))

// The is_owner column and its migration are left in place as unused-but-
// harmless infrastructure after Istvan removed the recurring-template
// authorization gate (2026-09-23) -- kept tested since a future feature
// may still want a real "who is the dashboard owner" signal.
describe('dashboard_users.is_owner migration', () => {
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
})
