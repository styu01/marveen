import { describe, it, expect, afterAll, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SANDBOX = mkdtempSync(join(tmpdir(), 'gate-archive-'))
vi.mock('../config.js', () => ({ PROJECT_ROOT: SANDBOX }))

const {
  CONTEXT_RESTART_ARCHIVE_DIR,
  archiveTranscriptBeforeContextRestart,
  CONTEXT_RESTART_ARCHIVE_RETENTION_MS,
  deriveTranscriptTopicHint,
  formatFullTranscriptForArchive,
  pruneExpiredContextRestartArchives,
} = await import('../web/context-restart-transcript-archive.js')
const { projectsDirFor } = await import('../web/active-model.js')

afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }))

function writeTranscript(workingDir: string, configDir: string, content: string): string {
  const dir = projectsDirFor(workingDir, configDir)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, content, 'utf-8')
  return path
}

describe('context-restart cold transcript archive', () => {
  it('exports every record as searchable text before clear, with a safe filename hint', () => {
    const workingDir = join(SANDBOX, 'agents', 'iris')
    const configDir = join(SANDBOX, 'config')
    const source = writeTranscript(workingDir, configDir, [
      JSON.stringify({ timestamp: '2026-09-16T08:00:00.000Z', message: { role: 'user', content: 'Fix the Kanban restart gate safely' } }),
      JSON.stringify({ timestamp: '2026-09-16T08:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'I will inspect it.' }] } }),
      '{partial-json',
    ].join('\n'))

    const result = archiveTranscriptBeforeContextRestart({
      agent: 'iris', workingDir, configDir, nowMs: Date.parse('2026-09-16T08:02:03.000Z'),
    })

    expect(result.sourcePath).toBe(source)
    expect(result.path).toContain(CONTEXT_RESTART_ARCHIVE_DIR)
    expect(result.path).toMatch(/iris_2026-09-16T08:02:03\.000Z_fix-the-kanban-restart-gate\.txt$/)
    const archive = readFileSync(result.path, 'utf-8')
    expect(archive).toContain('research/emergency archive only')
    expect(archive).toContain('NEVER load this entire file into an agent context')
    expect(archive).toContain('Fix the Kanban restart gate safely')
    expect(archive).toContain('I will inspect it.')
    expect(archive).toContain('[MALFORMED JSONL RECORD - preserved verbatim]')
    expect(archive).toContain('{partial-json')
  })

  it('uses no topic suffix when no safe user-message hint is available', () => {
    expect(deriveTranscriptTopicHint(JSON.stringify({ message: { role: 'assistant', content: 'only assistant' } }))).toBeNull()
  })

  it('refuses an archive when no transcript exists, rather than allowing an unarchived clear', () => {
    expect(() => archiveTranscriptBeforeContextRestart({
      agent: 'iris', workingDir: join(SANDBOX, 'missing'), configDir: join(SANDBOX, 'missing-config'), nowMs: Date.now(),
    })).toThrow(/no readable session transcript/)
  })

  it('formats all valid and malformed input records rather than silently dropping an interrupted line', () => {
    const formatted = formatFullTranscriptForArchive('{"a":1}\nnot-json\n', '/source.jsonl')
    expect(formatted).toContain('"a": 1')
    expect(formatted).toContain('not-json')
  })

  it('prunes only regular .txt cold archives older than 60 days by filesystem mtime', () => {
    const directory = join(SANDBOX, 'retention-fixture')
    mkdirSync(directory, { recursive: true })
    const oldArchive = join(directory, 'iris_old.txt')
    const freshArchive = join(directory, 'iris_fresh.txt')
    const exactBoundary = join(directory, 'iris_boundary.txt')
    const nonArchive = join(directory, 'writing.tmp')
    writeFileSync(oldArchive, 'old', 'utf-8')
    writeFileSync(freshArchive, 'fresh', 'utf-8')
    writeFileSync(exactBoundary, 'boundary', 'utf-8')
    writeFileSync(nonArchive, 'must not be touched', 'utf-8')
    const nowMs = Date.parse('2026-09-16T12:00:00.000Z')
    const oldMs = nowMs - CONTEXT_RESTART_ARCHIVE_RETENTION_MS - 1
    const freshMs = nowMs - CONTEXT_RESTART_ARCHIVE_RETENTION_MS + 1
    const boundaryMs = nowMs - CONTEXT_RESTART_ARCHIVE_RETENTION_MS
    utimesSync(oldArchive, oldMs / 1000, oldMs / 1000)
    utimesSync(freshArchive, freshMs / 1000, freshMs / 1000)
    utimesSync(exactBoundary, boundaryMs / 1000, boundaryMs / 1000)

    const result = pruneExpiredContextRestartArchives(directory, nowMs)

    expect(result.deleted).toEqual([oldArchive])
    expect(result.failed).toEqual([])
    expect(existsSync(oldArchive)).toBe(false)
    expect(existsSync(freshArchive)).toBe(true)
    expect(existsSync(exactBoundary)).toBe(true)
    expect(existsSync(nonArchive)).toBe(true)
  })
})
