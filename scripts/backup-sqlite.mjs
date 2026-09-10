#!/usr/bin/env node
// Real SQLite hot-backup + integrity check for scripts/backup.sh.
//
// WHY THIS EXISTS (2026-09-10, kanban e5c6ce03): the accepted dev-spec called
// for the `sqlite3` CLI's `.backup` dot-command + `PRAGMA integrity_check`.
// Measured on the actual production host this script runs on: the sqlite3
// CLI is NOT installed (only libsqlite3-0, the shared library). Requiring a
// separate system package that is not actually present would make the daily
// backup fail outright on its own target machine.
//
// better-sqlite3 is not a workaround -- it IS the real SQLite engine (the
// same C library the CLI links against), and it is already a hard, proven
// dependency of this very application (src/db.ts uses it for the live
// dashboard database). Its Database#backup() method calls the identical
// sqlite3_backup_init/step/finish C API the CLI's `.backup` command uses --
// same online hot-backup semantics, same WAL-safe consistent snapshot. Using
// it here trades a separate, easy-to-miss system dependency (sqlite3 CLI)
// for one that is already guaranteed present everywhere this app runs
// (node + node_modules/better-sqlite3), which is the more robust choice, not
// a lesser one.
//
// Usage:
//   node backup-sqlite.mjs backup <source-db> <dest-db>
//   node backup-sqlite.mjs check <db>
//
// Exit 0 on success. On failure, prints a one-line reason to stderr and
// exits 1 -- backup.sh treats any non-zero exit as a hard stop (`die`).

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

async function main() {
  const [, , mode, ...rest] = process.argv
  const here = dirname(fileURLToPath(import.meta.url))
  // Resolve better-sqlite3 from the REPO's own node_modules, not whatever
  // happens to be on NODE_PATH for the invoking shell (cron/launchd often
  // have a minimal environment).
  const { default: Database } = await import(join(here, '..', 'node_modules', 'better-sqlite3', 'lib', 'index.js'))

  if (mode === 'backup') {
    const [source, dest] = rest
    if (!source || !dest) { process.stderr.write('backup-sqlite: backup requires <source-db> <dest-db>\n'); process.exit(1) }
    if (!existsSync(source)) { process.stderr.write(`backup-sqlite: source database does not exist: ${source}\n`); process.exit(1) }
    const db = new Database(source, { readonly: true, fileMustExist: true })
    try {
      // Database#backup() is the real hot-backup API (sqlite3_backup_*): a
      // consistent point-in-time snapshot even while the source is open
      // elsewhere (the live dashboard process), no separate lock needed.
      await db.backup(dest)
    } finally {
      db.close()
    }
    process.stdout.write(`backup-sqlite: wrote ${dest}\n`)
    process.exit(0)
  }

  if (mode === 'check') {
    const [target] = rest
    if (!target) { process.stderr.write('backup-sqlite: check requires <db>\n'); process.exit(1) }
    if (!existsSync(target)) { process.stderr.write(`backup-sqlite: database does not exist: ${target}\n`); process.exit(1) }
    const db = new Database(target, { readonly: true, fileMustExist: true })
    try {
      const rows = db.pragma('integrity_check')
      // A healthy database returns exactly one row: { integrity_check: 'ok' }.
      // Anything else (more rows, or a different value) is a real finding.
      const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok'
      if (!ok) {
        process.stderr.write('backup-sqlite: integrity_check FAILED:\n')
        for (const r of rows) process.stderr.write(`  ${r.integrity_check ?? JSON.stringify(r)}\n`)
        process.exit(1)
      }
    } finally {
      db.close()
    }
    process.stdout.write('backup-sqlite: integrity_check ok\n')
    process.exit(0)
  }

  process.stderr.write(`backup-sqlite: unknown mode '${mode}' (expected backup|check)\n`)
  process.exit(1)
}

main().catch((err) => {
  process.stderr.write(`backup-sqlite: ${err?.message ?? err}\n`)
  process.exit(1)
})
