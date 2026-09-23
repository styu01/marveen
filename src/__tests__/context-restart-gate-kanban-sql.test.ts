import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { BLOCKING_KANBAN_CARD_FOR_ASSIGNEE_SQL } from '../db.js'

describe('context-restart gate Kanban SQL', () => {
  it('ignores recurring templates but blocks other assigned non-done, non-archived cards', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE kanban_cards (assignee TEXT, status TEXT, archived_at INTEGER, is_recurring_template INTEGER)')
      const insert = db.prepare('INSERT INTO kanban_cards VALUES (?, ?, ?, ?)')
      insert.run('iris', 'done', null, 0)
      insert.run('iris', 'in_progress', 1_700_000_000, 0)
      insert.run('other', 'in_progress', null, 0)
      insert.run('iris', 'in_progress', null, 1)
      expect(db.prepare(BLOCKING_KANBAN_CARD_FOR_ASSIGNEE_SQL).get('iris')).toBeUndefined()

      insert.run('iris', 'waiting', null, 0)
      expect(db.prepare(BLOCKING_KANBAN_CARD_FOR_ASSIGNEE_SQL).get('iris')).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
