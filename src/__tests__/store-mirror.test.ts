import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, chmodSync, symlinkSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

// store-mirror.sh (kanban 13e3e0a7, 2026-09-10): a SEPARATE, PLAINTEXT local
// mirror of store/ content, added alongside backup.sh's encrypted archive
// because the destination (a WSL DrvFs mount) is not cloud-synced, and
// Istvan wants the customer content itself browsable from Windows, not just
// an encrypted archive. Defaults to customer-content-only scope; `full`
// scope (the entire store/ tree, PLAINTEXT, including app secrets) requires
// explicit opt-in and is never the silent default.
const REPO_ROOT = join(__dirname, '..', '..')
const REAL_SCRIPT = join(REPO_ROOT, 'scripts', 'store-mirror.sh')
const REAL_SQLITE_HELPER = join(REPO_ROOT, 'scripts', 'backup-sqlite.mjs')

let SANDBOX = ''
let FAKE_REPO = ''
let DEST_ROOT = ''

function run(envOverrides: Record<string, string | undefined> = {}): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [join(FAKE_REPO, 'scripts', 'store-mirror.sh')], {
    env: { ...process.env, BACKUP_DEST_ROOT: DEST_ROOT, ...envOverrides },
    encoding: 'utf-8',
  })
}

function mirrorDir(): string {
  return join(DEST_ROOT, 'store-mirror')
}

function latestArchive(): string {
  const files = readdirSync(mirrorDir()).filter((f) => f.endsWith('.tar.gz'))
  expect(files.length).toBeGreaterThan(0)
  return join(mirrorDir(), files[files.length - 1])
}

beforeEach(() => {
  SANDBOX = mkdtempSync(join(tmpdir(), 'storemirror-'))
  FAKE_REPO = join(SANDBOX, 'repo')
  mkdirSync(join(FAKE_REPO, 'scripts'), { recursive: true })
  mkdirSync(join(FAKE_REPO, 'store'), { recursive: true })
  cpSync(REAL_SCRIPT, join(FAKE_REPO, 'scripts', 'store-mirror.sh'))
  chmodSync(join(FAKE_REPO, 'scripts', 'store-mirror.sh'), 0o755)
  cpSync(REAL_SQLITE_HELPER, join(FAKE_REPO, 'scripts', 'backup-sqlite.mjs'))
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(FAKE_REPO, 'node_modules'))
  DEST_ROOT = join(SANDBOX, 'destination')
  mkdirSync(DEST_ROOT, { recursive: true })
})
afterEach(() => { rmSync(SANDBOX, { recursive: true, force: true }) })

describe('scripts/store-mirror.sh', () => {
  it('customer scope (default) mirrors projects/reference-docs/references only, never secrets', () => {
    mkdirSync(join(FAKE_REPO, 'store', 'projects', 'acme'), { recursive: true })
    writeFileSync(join(FAKE_REPO, 'store', 'projects', 'acme', 'contract.txt'), 'customer content')
    mkdirSync(join(FAKE_REPO, 'store', 'reference-docs'), { recursive: true })
    writeFileSync(join(FAKE_REPO, 'store', 'reference-docs', 'brief.pdf'), 'reference content')
    // Secrets that must NEVER appear in the customer-scope archive.
    writeFileSync(join(FAKE_REPO, 'store', '.dashboard-token'), 'super-secret-token')
    writeFileSync(join(FAKE_REPO, 'store', 'config-overrides.json'), '{"secret":true}')

    const res = run()
    expect(res.status, String(res.stdout) + String(res.stderr)).toBe(0)
    expect(res.stdout).toMatch(/scope=customer/)

    const list = spawnSync('tar', ['-tzf', latestArchive()], { encoding: 'utf-8' }).stdout
    expect(list).toContain('projects/acme/contract.txt')
    expect(list).toContain('reference-docs/brief.pdf')
    expect(list).not.toContain('.dashboard-token')
    expect(list).not.toContain('config-overrides.json')
  })

  it('full scope includes app secrets AND hot-backs-up the DB (never a raw copy)', () => {
    writeFileSync(join(FAKE_REPO, 'store', '.dashboard-token'), 'super-secret-token')
    const db = new Database(join(FAKE_REPO, 'store', 'claudeclaw.db'))
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t (v) VALUES (?)').run('store-mirror-full-scope-row')
    db.close()

    const res = run({ STORE_MIRROR_SCOPE: 'full' })
    expect(res.status, String(res.stdout) + String(res.stderr)).toBe(0)
    expect(res.stdout).toMatch(/scope=full/)
    expect(res.stdout).toMatch(/integrity_check ok/)

    const restoreDir = join(SANDBOX, 'restore')
    mkdirSync(restoreDir, { recursive: true })
    spawnSync('tar', ['-xzf', latestArchive(), '-C', restoreDir])
    expect(readFileSync(join(restoreDir, 'store', '.dashboard-token'), 'utf-8')).toBe('super-secret-token')
    const restoredDb = new Database(join(restoreDir, 'store', 'claudeclaw.db'), { readonly: true })
    expect(restoredDb.prepare('SELECT v FROM t').get()).toEqual({ v: 'store-mirror-full-scope-row' })
    expect(restoredDb.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    restoredDb.close()
  })

  it('refuses a corrupt database in full scope instead of silently mirroring it', () => {
    writeFileSync(join(FAKE_REPO, 'store', 'claudeclaw.db'), 'not a real sqlite database')
    const res = run({ STORE_MIRROR_SCOPE: 'full' })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/file is not a database|SQLite hot-backup failed|integrity_check/)
    expect(existsSync(mirrorDir()) && readdirSync(mirrorDir()).length > 0).toBe(false)
  })

  it('rejects an unknown STORE_MIRROR_SCOPE value', () => {
    const res = run({ STORE_MIRROR_SCOPE: 'bogus' })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/STORE_MIRROR_SCOPE must be/)
  })

  it('refuses to run without BACKUP_DEST_ROOT', () => {
    const res = spawnSync('bash', [join(FAKE_REPO, 'scripts', 'store-mirror.sh')], {
      env: { ...process.env, BACKUP_DEST_ROOT: undefined },
      encoding: 'utf-8',
    })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/BACKUP_DEST_ROOT must be set/)
  })

  it('keeps only the newest STORE_MIRROR_RETENTION_COUNT generations, independent of scope', () => {
    mkdirSync(join(FAKE_REPO, 'store', 'projects'), { recursive: true })
    writeFileSync(join(FAKE_REPO, 'store', 'projects', 'x.txt'), 'x')
    for (let i = 0; i < 3; i++) {
      const res = run({ STORE_MIRROR_RETENTION_COUNT: '2' })
      expect(res.status, String(res.stdout) + String(res.stderr)).toBe(0)
      spawnSync('sleep', ['1.1']) // STAMP has 1s resolution
    }
    expect(readdirSync(mirrorDir()).filter((f) => f.endsWith('.tar.gz')).length).toBe(2)
  })

  it('refuses to overwrite an existing archive at the same timestamped path (no-clobber)', () => {
    mkdirSync(join(FAKE_REPO, 'store', 'projects'), { recursive: true })
    writeFileSync(join(FAKE_REPO, 'store', 'projects', 'x.txt'), 'x')
    const frozenStamp = '20260101-000000'
    const shimDir = join(SANDBOX, 'shim-bin-date')
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(join(shimDir, 'date'), `#!/bin/sh\ncase "$1" in\n  +%Y%m%d-%H%M%S) echo '${frozenStamp}' ;;\n  *) exec /bin/date "$@" ;;\nesac\n`)
    chmodSync(join(shimDir, 'date'), 0o755)
    mkdirSync(mirrorDir(), { recursive: true })
    const collidingPath = join(mirrorDir(), `store-mirror-customer-${frozenStamp}.tar.gz`)
    writeFileSync(collidingPath, 'pre-existing-must-survive')
    const res = run({ PATH: `${shimDir}:${process.env.PATH}` })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/refusing to overwrite existing archive/)
    expect(readFileSync(collidingPath, 'utf-8')).toBe('pre-existing-must-survive')
  })

  it('reports nothing-to-mirror cleanly (exit 0) when the scoped content is entirely absent', () => {
    // store/ has no projects/reference-docs/references at all in this fixture.
    const res = run()
    expect(res.status).toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/nothing to mirror/)
    expect(existsSync(mirrorDir()) && readdirSync(mirrorDir()).length > 0).toBe(false)
  })

  it('refuses to run when a concurrent store-mirror already holds the LOCAL lock (Codex review, 2026-09-10)', () => {
    // The lock lives in REPO_ROOT/backups/, NOT on BACKUP_DEST_ROOT -- a WSL
    // DrvFs destination cannot be trusted to honor flock's kernel locking
    // any more than it honors chmod (see the script's own SECURITY NOTE).
    mkdirSync(join(FAKE_REPO, 'store', 'projects'), { recursive: true })
    writeFileSync(join(FAKE_REPO, 'store', 'projects', 'x.txt'), 'x')
    const lockDir = join(FAKE_REPO, 'backups')
    mkdirSync(lockDir, { recursive: true, mode: 0o700 })
    const lockPath = join(lockDir, '.store-mirror.lock')
    writeFileSync(lockPath, '')
    const res = spawnSync('bash', ['-c', `
      exec 8>'${lockPath}'
      flock 8 || exit 99
      bash "$0"
      echo "RUN_EXIT:$?"
    `, join(FAKE_REPO, 'scripts', 'store-mirror.sh')], {
      env: { ...process.env, BACKUP_DEST_ROOT: DEST_ROOT },
      encoding: 'utf-8',
    })
    expect(res.stdout).not.toContain('RUN_EXIT:0')
    expect(String(res.stdout) + String(res.stderr)).toMatch(/another store-mirror run is already in progress/)
  })
})
