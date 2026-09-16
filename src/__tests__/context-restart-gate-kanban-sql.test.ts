import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { OPEN_KANBAN_CARD_FOR_ASSIGNEE_SQL } from '../db.js'

describe('context-restart gate Kanban SQL', () => {
  it('blocks only cards assigned to the agent that are non-done AND non-archived', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE kanban_cards (assignee TEXT, status TEXT, archived_at INTEGER)')
      const insert = db.prepare('INSERT INTO kanban_cards VALUES (?, ?, ?)')
      insert.run('iris', 'done', null)
      insert.run('iris', 'in_progress', 1_700_000_000)
      insert.run('other', 'in_progress', null)
      expect(db.prepare(OPEN_KANBAN_CARD_FOR_ASSIGNEE_SQL).get('iris')).toBeUndefined()

      insert.run('iris', 'waiting', null)
      expect(db.prepare(OPEN_KANBAN_CARD_FOR_ASSIGNEE_SQL).get('iris')).toBeTruthy()
    } finally {
      db.close()
    }
  })
})
