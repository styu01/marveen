import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, chmodSync, symlinkSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

// Encryption layer (2026-09-10, kanban e5c6ce03): backup.sh publishes a GPG
// AES256-encrypted copy of the already-verified plaintext archive to
// BACKUP_DEST_ROOT/encrypted, on top of the pre-existing plaintext coverage
// tested in backup-script-coverage.test.ts. These tests run the REAL script
// end to end (real gpg, real better-sqlite3 via backup-sqlite.mjs), same
// convention as that file, so a regression in the actual pipeline -- not
// just a source-pattern match -- fails here.
const REPO_ROOT = join(__dirname, '..', '..')
const REAL_BACKUP_SCRIPT = join(REPO_ROOT, 'scripts', 'backup.sh')
const REAL_SQLITE_HELPER = join(REPO_ROOT, 'scripts', 'backup-sqlite.mjs')

let SANDBOX = ''
let FAKE_REPO = ''
let FAKE_HOME = ''
let PASSPHRASE_FILE = ''
let DEST_ROOT = ''

function seedRealDb(): void {
  const db = new Database(join(FAKE_REPO, 'store', 'claudeclaw.db'))
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t (v) VALUES (?)').run('encryption-test-row')
  db.close()
}

function runBackup(envOverrides: Record<string, string | undefined> = {}): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [join(FAKE_REPO, 'scripts', 'backup.sh')], {
    env: {
      ...process.env,
      HOME: FAKE_HOME,
      BACKUP_PASSPHRASE_FILE: PASSPHRASE_FILE,
      BACKUP_DEST_ROOT: DEST_ROOT,
      ...envOverrides,
    },
    encoding: 'utf-8',
  })
}

function encryptedDir(): string {
  return join(DEST_ROOT, 'encrypted')
}

function latestEncryptedArchive(): string {
  const dir = encryptedDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.tar.gz.gpg'))
  expect(files.length).toBeGreaterThan(0)
  return join(dir, files[files.length - 1])
}

function decrypt(archive: string, passphraseFile: string): ReturnType<typeof spawnSync> {
  return spawnSync('gpg', [
    '--batch', '--no-tty', '--pinentry-mode', 'loopback',
    '--passphrase-file', passphraseFile, '--decrypt', archive,
  ], { encoding: 'buffer' })
}

beforeEach(() => {
  SANDBOX = mkdtempSync(join(tmpdir(), 'backupsh-enc-'))
  FAKE_REPO = join(SANDBOX, 'repo')
  FAKE_HOME = join(SANDBOX, 'home')
  mkdirSync(join(FAKE_REPO, 'scripts'), { recursive: true })
  mkdirSync(join(FAKE_REPO, 'store'), { recursive: true })
  mkdirSync(FAKE_HOME, { recursive: true })
  cpSync(REAL_BACKUP_SCRIPT, join(FAKE_REPO, 'scripts', 'backup.sh'))
  chmodSync(join(FAKE_REPO, 'scripts', 'backup.sh'), 0o755)
  cpSync(REAL_SQLITE_HELPER, join(FAKE_REPO, 'scripts', 'backup-sqlite.mjs'))
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(FAKE_REPO, 'node_modules'))
  writeFileSync(join(FAKE_REPO, 'store', 'vault.json'), '{}')

  PASSPHRASE_FILE = join(SANDBOX, 'passphrase')
  writeFileSync(PASSPHRASE_FILE, 'sandbox-throwaway-test-passphrase-not-real\n')
  chmodSync(PASSPHRASE_FILE, 0o600)
  DEST_ROOT = join(SANDBOX, 'destination')
  mkdirSync(DEST_ROOT, { recursive: true })
})
afterEach(() => { rmSync(SANDBOX, { recursive: true, force: true }) })

describe('scripts/backup.sh: encrypted output', () => {
  it('publishes a verified, GPG AES256-encrypted copy that decrypts back to the exact plaintext archive', () => {
    seedRealDb()
    const res = runBackup()
    expect(res.status, res.stderr as string).toBe(0)
    expect(res.stdout).toMatch(/backup: encrypted archive verified byte-identical to plaintext/)

    const plainDir = join(FAKE_REPO, 'backups')
    const plainArchive = readdirSync(plainDir).filter((f) => f.endsWith('.tar.gz'))[0]
    const plainBytes = readFileSync(join(plainDir, plainArchive))

    const encArchive = latestEncryptedArchive()
    expect(readFileSync(encArchive).equals(plainBytes)).toBe(false) // actually encrypted, not a copy

    const dec = decrypt(encArchive, PASSPHRASE_FILE)
    expect(dec.status, dec.stderr?.toString()).toBe(0)
    expect((dec.stdout as Buffer).equals(plainBytes)).toBe(true) // real restore drill: byte-identical
  })

  it('the encrypted archive genuinely round-trips to real, queryable data (full restore drill)', () => {
    seedRealDb()
    const res = runBackup()
    expect(res.status, res.stderr as string).toBe(0)

    const dec = decrypt(latestEncryptedArchive(), PASSPHRASE_FILE)
    expect(dec.status).toBe(0)
    const restoreDir = join(SANDBOX, 'restore')
    mkdirSync(restoreDir, { recursive: true })
    const tar = spawnSync('tar', ['-xzf', '-', '-C', restoreDir], { input: dec.stdout as Buffer })
    expect(tar.status).toBe(0)

    const restoredDb = new Database(join(restoreDir, 'repo', 'store', 'claudeclaw.db'), { readonly: true })
    expect(restoredDb.prepare('SELECT v FROM t').get()).toEqual({ v: 'encryption-test-row' })
    expect(restoredDb.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    restoredDb.close()
    expect(readFileSync(join(restoreDir, 'repo', 'store', 'vault.json'), 'utf-8')).toBe('{}')
  })

  it('a wrong passphrase fails to decrypt (proves the encryption is real, not a no-op)', () => {
    seedRealDb()
    const res = runBackup()
    expect(res.status).toBe(0)
    const wrongPassphrase = join(SANDBOX, 'wrong-passphrase')
    writeFileSync(wrongPassphrase, 'definitely-not-the-right-passphrase\n')
    chmodSync(wrongPassphrase, 0o600)
    const dec = decrypt(latestEncryptedArchive(), wrongPassphrase)
    expect(dec.status).not.toBe(0)
  })

  it('refuses a corrupt/invalid database instead of silently backing it up', () => {
    writeFileSync(join(FAKE_REPO, 'store', 'claudeclaw.db'), 'not a real sqlite database, just garbage bytes')
    const res = runBackup()
    expect(res.status).not.toBe(0)
    // A non-SQLite file fails at the hot-backup/open step itself (better-
    // sqlite3 refuses to open it at all) -- before integrity_check even runs.
    // Same protective outcome (refused, nothing published), earlier failure.
    expect(String(res.stdout) + String(res.stderr)).toMatch(/file is not a database|SQLite hot-backup failed|integrity_check/)
    // Nothing gets published on a refused run.
    expect(existsSync(encryptedDir()) && readdirSync(encryptedDir()).length > 0).toBe(false)
  })

  it('never publishes an encrypted copy when GPG encryption itself fails', () => {
    seedRealDb()
    // Shadow the real gpg with a failing shim earlier on PATH, so the script
    // gets all the way to the encryption step (passing every prior check)
    // and fails there specifically -- the realistic failure mode (a transient
    // gpg error), not a missing-binary environment problem.
    const shimDir = join(SANDBOX, 'shim-bin')
    mkdirSync(shimDir, { recursive: true })
    writeFileSync(join(shimDir, 'gpg'), '#!/bin/sh\necho "synthetic gpg failure" >&2\nexit 1\n')
    chmodSync(join(shimDir, 'gpg'), 0o755)
    const res = runBackup({ PATH: `${shimDir}:${process.env.PATH}` })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/GPG encryption failed/)
    // The plaintext archive must exist and be untouched -- an encryption
    // failure must never take the already-verified plaintext backup with it.
    const plainArchives = readdirSync(join(FAKE_REPO, 'backups')).filter((f) => f.endsWith('.tar.gz'))
    expect(plainArchives.length).toBe(1)
    // And nothing gets published to the encrypted destination on this path.
    expect(existsSync(encryptedDir()) && readdirSync(encryptedDir()).some((f) => f.endsWith('.gpg'))).toBe(false)
  })

  for (const [label, mode] of [['symlink', null], ['0644', 0o644], ['0660', 0o660]] as const) {
    it(`rejects a passphrase file with the wrong mode (${label})`, () => {
      seedRealDb()
      const badPassphrase = join(SANDBOX, `bad-passphrase-${label}`)
      if (mode === null) {
        symlinkSync(PASSPHRASE_FILE, badPassphrase)
      } else {
        writeFileSync(badPassphrase, 'x'.repeat(20) + '\n')
        chmodSync(badPassphrase, mode)
      }
      const res = runBackup({ BACKUP_PASSPHRASE_FILE: badPassphrase })
      expect(res.status).not.toBe(0)
      expect(String(res.stdout) + String(res.stderr)).toMatch(/symlink|mode must be exactly 0600/)
    })
  }

  it('rejects a multi-line or empty passphrase file', () => {
    seedRealDb()
    const multiline = join(SANDBOX, 'multiline-passphrase')
    writeFileSync(multiline, 'line-one\nline-two\n')
    chmodSync(multiline, 0o600)
    let res = runBackup({ BACKUP_PASSPHRASE_FILE: multiline })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/exactly one non-empty line/)

    const empty = join(SANDBOX, 'empty-passphrase')
    writeFileSync(empty, '')
    chmodSync(empty, 0o600)
    res = runBackup({ BACKUP_PASSPHRASE_FILE: empty })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/non-empty regular file/)
  })

  it('refuses to run when BACKUP_DEST_ROOT does not exist', () => {
    seedRealDb()
    const res = runBackup({ BACKUP_DEST_ROOT: join(SANDBOX, 'does-not-exist') })
    expect(res.status).not.toBe(0)
    expect(String(res.stdout) + String(res.stderr)).toMatch(/BACKUP_DEST_ROOT must already exist/)
  })

  it('refuses to run when a concurrent backup already holds the lock', () => {
    seedRealDb()
    mkdirSync(join(FAKE_REPO, 'backups'), { recursive: true, mode: 0o700 })
    const lockPath = join(FAKE_REPO, 'backups', '.backup.lock')
    writeFileSync(lockPath, '')
    // Hold the SAME lock file (fd 8, non-blocking flock -- the same call
    // backup.sh itself makes) in this one shell invocation, then run
    // backup.sh as a CHILD of that same shell so it inherits the held lock
    // file and observes it via its own independent fd 9. `flock -n` fails
    // immediately rather than blocking, so this is deterministic -- no
    // sleep-based guessing about a real concurrent run.
    const res = spawnSync('bash', ['-c', `
      exec 8>'${lockPath}'
      flock 8 || exit 99
      bash "$0"
      echo "BACKUP_EXIT:$?"
    `, join(FAKE_REPO, 'scripts', 'backup.sh')], {
      env: {
        ...process.env,
        HOME: FAKE_HOME,
        BACKUP_PASSPHRASE_FILE: PASSPHRASE_FILE,
        BACKUP_DEST_ROOT: DEST_ROOT,
      },
      encoding: 'utf-8',
    })
    expect(res.stdout).not.toContain('BACKUP_EXIT:0')
    expect(String(res.stdout) + String(res.stderr)).toMatch(/another backup is already running/)
  })

  it('prunes the encrypted destination independently, keeping only the most recent BACKUP_ENCRYPTED_RETENTION_COUNT', () => {
    seedRealDb()
    for (let i = 0; i < 3; i++) {
      const res = runBackup({ BACKUP_ENCRYPTED_RETENTION_COUNT: '2' })
      expect(res.status, res.stderr as string).toBe(0)
      // STAMP has 1-second resolution; force distinct timestamps so no run
      // collides with (and no-clobber-refuses to overwrite) the previous one.
      spawnSync('sleep', ['1.1'])
    }
    const remaining = readdirSync(encryptedDir()).filter((f) => f.endsWith('.gpg'))
    expect(remaining.length).toBe(2)
  })

  // Codex review, 2026-09-10 -- 4 blocking findings on the first version of
  // this layer, each pinned here so none of them can silently regress.
  describe('Codex review fixes (2026-09-10)', () => {
    it('BLOCKING #1a: refuses a passphrase placed inside a DIRECTORY source under $HOME (.claude/skills)', () => {
      seedRealDb()
      const skillsDir = join(FAKE_HOME, '.claude', 'skills')
      mkdirSync(skillsDir, { recursive: true })
      const leakyPassphrase = join(skillsDir, 'private-passphrase')
      writeFileSync(leakyPassphrase, 'leaky-passphrase-inside-skills-dir\n')
      chmodSync(leakyPassphrase, 0o600)
      const res = runBackup({ BACKUP_PASSPHRASE_FILE: leakyPassphrase })
      expect(res.status).not.toBe(0)
      expect(String(res.stdout) + String(res.stderr))
        .toMatch(/passphrase file is inside a directory this run would archive wholesale/)
      // And nothing was published on this refused run.
      expect(existsSync(join(FAKE_REPO, 'backups'))
        && readdirSync(join(FAKE_REPO, 'backups')).some((f) => f.endsWith('.tar.gz'))).toBe(false)
    })

    it('BLOCKING #1b: refuses a passphrase placed inside a DIRECTORY source under the repo (assets/meetings)', () => {
      seedRealDb()
      const meetingsDir = join(FAKE_REPO, 'assets', 'meetings')
      mkdirSync(meetingsDir, { recursive: true })
      const leakyPassphrase = join(meetingsDir, 'private-passphrase')
      writeFileSync(leakyPassphrase, 'leaky-passphrase-inside-meetings-dir\n')
      chmodSync(leakyPassphrase, 0o600)
      const res = runBackup({ BACKUP_PASSPHRASE_FILE: leakyPassphrase })
      expect(res.status).not.toBe(0)
      // Caught by the broader "inside the project root" guard (runs earlier,
      // before staging even starts) rather than check_not_passphrase's more
      // specific directory-containment check -- any repo-side path is a
      // strict subset of "inside REPO_ROOT", so that guard alone already
      // covers this case. Still a real, end-to-end regression guard: proves
      // a passphrase under a repo-side backed-up DIRECTORY is rejected.
      expect(String(res.stdout) + String(res.stderr))
        .toMatch(/passphrase file is inside the project root/)
    })

    it('BLOCKING #1c (regression guard): a passphrase OUTSIDE every backed-up tree still runs cleanly end to end', () => {
      // The fix for #1a/#1b changed check_not_passphrase's control flow
      // entirely (adding an explicit `return 0`); this proves the ORDINARY,
      // expected case -- no match anywhere -- still succeeds and is not
      // itself a false positive or a silent `set -e` abort.
      seedRealDb()
      const res = runBackup()
      expect(res.status, String(res.stdout) + String(res.stderr)).toBe(0)
      expect(res.stdout).toMatch(/backup: SUCCESS/)
    })

    it('BLOCKING #2: a GPG failure prunes NEITHER old plaintext NOR the fresh one -- retention only runs after a successful publish', () => {
      seedRealDb()
      const backupsDir = join(FAKE_REPO, 'backups')
      mkdirSync(backupsDir, { recursive: true, mode: 0o700 })
      // Simulate 20 pre-existing plaintext generations (well above the
      // script's hardcoded KEEP=14) with fabricated but correctly-shaped
      // names, old enough to sort before anything this run creates.
      const staleNames: string[] = []
      for (let i = 0; i < 20; i++) {
        const name = `claudeclaw-2026010${String(i).padStart(2, '0')}-000000.tar.gz`
        writeFileSync(join(backupsDir, name), 'fake-old-archive-content')
        staleNames.push(name)
      }
      const shimDir = join(SANDBOX, 'shim-bin-2')
      mkdirSync(shimDir, { recursive: true })
      writeFileSync(join(shimDir, 'gpg'), '#!/bin/sh\nexit 1\n')
      chmodSync(join(shimDir, 'gpg'), 0o755)
      const res = runBackup({ PATH: `${shimDir}:${process.env.PATH}` })
      expect(res.status).not.toBe(0)
      const remaining = readdirSync(backupsDir)
      // Every fabricated stale archive must still be there...
      for (const name of staleNames) expect(remaining).toContain(name)
      // ...AND the fresh one this run wrote (already verified before the
      // encryption stage) must ALSO still be there -- a GPG failure must not
      // cost the plaintext backup this very run just produced either.
      expect(remaining.filter((f) => f.endsWith('.tar.gz')).length).toBe(21)
    })

    it('BLOCKING #3: refuses to overwrite an existing plaintext archive at the same timestamped path', () => {
      seedRealDb()
      const backupsDir = join(FAKE_REPO, 'backups')
      mkdirSync(backupsDir, { recursive: true, mode: 0o700 })
      // STAMP is `date +%Y%m%d-%H%M%S` (1s resolution) computed INSIDE the
      // script. Codex review: reading the host's `date` just before invoking
      // the script (comparing wall-clock seconds across two separate
      // processes) was theoretically flaky across a second boundary. A
      // frozen `date` shim ahead on PATH makes both sides deterministic --
      // the exact same fixed value, no race window at all.
      const frozenStamp = '20260101-000000'
      const shimDir = join(SANDBOX, 'shim-bin-date')
      mkdirSync(shimDir, { recursive: true })
      writeFileSync(join(shimDir, 'date'), `#!/bin/sh\ncase "$1" in\n  +%Y%m%d-%H%M%S) echo '${frozenStamp}' ;;\n  *) exec /bin/date "$@" ;;\nesac\n`)
      chmodSync(join(shimDir, 'date'), 0o755)
      const collidingPath = join(backupsDir, `claudeclaw-${frozenStamp}.tar.gz`)
      writeFileSync(collidingPath, 'pre-existing-archive-must-survive')
      const res = runBackup({ PATH: `${shimDir}:${process.env.PATH}` })
      expect(res.status).not.toBe(0)
      expect(String(res.stdout) + String(res.stderr)).toMatch(/refusing to overwrite existing plaintext backup/)
      // The pre-existing file's content must be untouched.
      expect(readFileSync(collidingPath, 'utf-8')).toBe('pre-existing-archive-must-survive')
    })

    it('BLOCKING #4: refuses a passphrase placed directly under BACKUP_DEST_ROOT, not just under its encrypted/ leaf', () => {
      seedRealDb()
      const leakyPassphrase = join(DEST_ROOT, 'passphrase-sitting-next-to-the-backups')
      writeFileSync(leakyPassphrase, 'leaky-passphrase-at-drive-root\n')
      chmodSync(leakyPassphrase, 0o600)
      const res = runBackup({ BACKUP_PASSPHRASE_FILE: leakyPassphrase })
      expect(res.status).not.toBe(0)
      expect(String(res.stdout) + String(res.stderr))
        .toMatch(/passphrase file is inside BACKUP_DEST_ROOT/)
    })
  })
})
