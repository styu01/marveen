#!/usr/bin/env bash
# Marveen store/ plaintext mirror (kanban 13e3e0a7, 2026-09-10).
#
# Separate from backup.sh's encrypted archive, added as its own script per
# Istvan's explicit request: a PLAINTEXT local copy of customer-facing
# content, because the Windows-side Google Drive client cannot see into
# WSL's filesystem, so the existing encrypted backup (retargeted to
# BACKUP_DEST_ROOT for this same reason) is not enough on its own for this
# specific use case -- Istvan wants the customer content itself browsable
# from Windows, not just an encrypted archive of it.
#
# SCOPE (STORE_MIRROR_SCOPE, default "customer"):
#   customer (default) -- store/projects, store/reference-docs,
#     store/references ONLY. This is customer/business content, not app
#     secrets. Matches what Istvan actually asked for ("ebben vannak az
#     ugyfelmunkak").
#   full -- the entire store/ tree, INCLUDING the files backup.sh's own
#     denylist calls out as sensitive (store/.dashboard-token,
#     config-overrides.json, claudeclaw.db, agent-taskstate, ...), in
#     PLAINTEXT. Requires explicit opt-in (STORE_MIRROR_SCOPE=full) --
#     never the silent default. The DB is never raw-copied (a live
#     WAL-mode SQLite file): it goes through the same consistent
#     hot-backup + integrity_check as backup.sh, via backup-sqlite.mjs.
#
# SECURITY NOTE -- measured 2026-09-10 on THIS host's actual destination
# (/mnt/d, a WSL DrvFs mount): chmod is SILENTLY A NO-OP there. A file
# written 0600 stays 777 on disk -- verified directly (`touch` + `chmod 600`
# + `stat` still showed 777). Anything landing on a DrvFs destination is
# therefore as exposed as any other file on that Windows drive to every
# Windows account/process that can reach it, NOT protected by the Linux
# permissions this script (and backup.sh) still sets defensively for any
# future destination that DOES honor them. This is materially different
# from "local disk, so safer than cloud sync" -- it is safer than syncing to
# a THIRD PARTY's cloud, but it is not access-controlled the way a native
# Linux filesystem would be. This is exactly why STORE_MIRROR_SCOPE defaults
# to customer-only: customer business content is lower-stakes than live
# app credentials sitting in cleartext on a drive with no OS-level ACL.

set -euo pipefail
umask 077

is_positive_integer() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DEST_ROOT="${BACKUP_DEST_ROOT:-}"
[[ -n "${BACKUP_DEST_ROOT}" ]] || { echo "store-mirror: BACKUP_DEST_ROOT must be set" >&2; exit 1; }
[[ -d "${BACKUP_DEST_ROOT}" ]] || { echo "store-mirror: BACKUP_DEST_ROOT must already exist and be a directory: ${BACKUP_DEST_ROOT}" >&2; exit 1; }

RETENTION_COUNT="${STORE_MIRROR_RETENTION_COUNT:-2}"
is_positive_integer "${RETENTION_COUNT}" || { echo "store-mirror: STORE_MIRROR_RETENTION_COUNT must be a positive integer" >&2; exit 1; }

SCOPE="${STORE_MIRROR_SCOPE:-customer}"
case "${SCOPE}" in
  customer|full) ;;
  *) echo "store-mirror: STORE_MIRROR_SCOPE must be 'customer' or 'full' (got: ${SCOPE})" >&2; exit 1 ;;
esac

STAMP="$(date +%Y%m%d-%H%M%S)"
MIRROR_DIR="${BACKUP_DEST_ROOT}/store-mirror"
mkdir -p "${MIRROR_DIR}"

# Own lock, separate from backup.sh's -- a manual test run must never
# interleave with a cron-fired one (or a second manual run) writing/pruning
# the SAME mirror dir concurrently. Deliberately placed on the LOCAL
# checkout (REPO_ROOT/backups/), NOT on BACKUP_DEST_ROOT: the destination in
# this deployment is a WSL DrvFs mount, and the SAME 9p-protocol filesystem
# that silently no-ops chmod (see the SECURITY NOTE above) cannot be trusted
# to honor flock's kernel-level locking either -- a lock file that looks
# like it exists but never actually blocks a second holder is worse than no
# lock at all (false confidence). backup.sh's own BACKUP_DIR is always a
# real local filesystem by construction (it is this repo's own directory),
# so the same directory is reused here for the lock file.
LOCAL_LOCK_DIR="${REPO_ROOT}/backups"
mkdir -p "${LOCAL_LOCK_DIR}"
LOCK_FILE="${LOCAL_LOCK_DIR}/.store-mirror.lock"
OS_NAME="$(uname -s)"
LOCK_KIND=""
LOCK_ACQUIRED=0
if [[ "${OS_NAME}" == "Darwin" ]]; then
  LOCK_DIR_PATH="${LOCK_FILE}.d"
  if mkdir "${LOCK_DIR_PATH}" 2>/dev/null; then
    LOCK_ACQUIRED=1
    LOCK_KIND="mkdir"
  else
    echo "store-mirror: another store-mirror run may be in progress; lock exists: ${LOCK_DIR_PATH}" >&2
    exit 1
  fi
else
  command -v flock >/dev/null 2>&1 || { echo "store-mirror: required command is missing: flock" >&2; exit 1; }
  exec 8>"${LOCK_FILE}"
  flock -n 8 || { echo "store-mirror: another store-mirror run is already in progress (lock: ${LOCK_FILE})" >&2; exit 1; }
  LOCK_KIND="flock"
fi

WORK_DIR="$(mktemp -d -t store-mirror-stage.XXXXXX)"
cleanup() {
  rm -rf "${WORK_DIR}"
  if [[ "${LOCK_KIND}" == "mkdir" && "${LOCK_ACQUIRED}" == "1" ]]; then
    rm -rf "${LOCK_DIR_PATH}"
  fi
}
trap cleanup EXIT

STAGE="${WORK_DIR}/stage"
mkdir -p "${STAGE}"

case "${SCOPE}" in
  customer)
    for d in projects reference-docs references; do
      if [[ -d "${REPO_ROOT}/store/${d}" ]]; then
        cp -pR "${REPO_ROOT}/store/${d}" "${STAGE}/${d}"
      fi
    done
    ;;
  full)
    if [[ -d "${REPO_ROOT}/store" ]]; then
      cp -pR "${REPO_ROOT}/store" "${STAGE}/store"
      # The live DB (+ WAL/SHM) must never be raw-copied -- same reasoning
      # as backup.sh: a plain cp of an open WAL-mode SQLite file is not a
      # consistent snapshot. Replace whatever cp -pR just copied with a real
      # hot-backup via the same helper backup.sh uses.
      rm -f "${STAGE}/store/claudeclaw.db" "${STAGE}/store/claudeclaw.db-wal" "${STAGE}/store/claudeclaw.db-shm"
      if [[ -f "${REPO_ROOT}/store/claudeclaw.db" ]]; then
        SQLITE_HELPER="${REPO_ROOT}/scripts/backup-sqlite.mjs"
        command -v node >/dev/null 2>&1 || { echo "store-mirror: node is required for full-scope DB mirror" >&2; exit 1; }
        [[ -f "${SQLITE_HELPER}" ]] || { echo "store-mirror: sqlite backup helper is missing: ${SQLITE_HELPER}" >&2; exit 1; }
        node "${SQLITE_HELPER}" backup "${REPO_ROOT}/store/claudeclaw.db" "${STAGE}/store/claudeclaw.db" \
          || { echo "store-mirror: SQLite hot-backup failed" >&2; exit 1; }
        node "${SQLITE_HELPER}" check "${STAGE}/store/claudeclaw.db" \
          || { echo "store-mirror: staged SQLite database failed integrity_check -- refusing to mirror a corrupt database" >&2; exit 1; }
      fi
    fi
    ;;
esac

if [[ -z "$(find "${STAGE}" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
  echo "store-mirror: nothing to mirror (scope=${SCOPE})" >&2
  exit 0
fi

ARCHIVE_NAME="store-mirror-${SCOPE}-${STAMP}.tar.gz"
ARCHIVE_TMP="${WORK_DIR}/${ARCHIVE_NAME}"
( cd "${STAGE}" && tar -czf "${ARCHIVE_TMP}" . )

# Self-verify: the archive must list exactly the files/symlinks that were
# staged, same "do not just trust tar's exit code" philosophy as backup.sh
# (lighter-weight here -- a file-count parity check, not a full path-set
# diff, since this script has no per-file allow/denylist that could drop an
# entry silently the way backup.sh's does).
if ! tar -tzf "${ARCHIVE_TMP}" > "${WORK_DIR}/actual-list.txt" 2>/dev/null; then
  echo "store-mirror: VERIFY FAILED -- could not list the contents of the written archive" >&2
  exit 1
fi
ACTUAL_COUNT="$(grep -vc '/$' "${WORK_DIR}/actual-list.txt" || true)"
EXPECTED_COUNT="$(cd "${STAGE}" && find . \( -type f -o -type l \) | wc -l | tr -d ' ')"
if [[ "${ACTUAL_COUNT}" != "${EXPECTED_COUNT}" ]]; then
  echo "store-mirror: VERIFY FAILED -- archive has ${ACTUAL_COUNT} file(s), staged had ${EXPECTED_COUNT}" >&2
  exit 1
fi
echo "store-mirror: verified -- archive contains ${ACTUAL_COUNT} staged file(s)/symlink(s)"

FINAL="${MIRROR_DIR}/${ARCHIVE_NAME}"
[[ ! -e "${FINAL}" ]] || { echo "store-mirror: refusing to overwrite existing archive: ${FINAL}" >&2; exit 1; }
mv "${ARCHIVE_TMP}" "${FINAL}"
chmod 600 "${FINAL}" 2>/dev/null || true
echo "store-mirror: wrote ${FINAL} (scope=${SCOPE})"

# Keep the newest RETENTION_COUNT mirrors, drop the rest. Independent of
# backup.sh's own retention counters.
ls -1t "${MIRROR_DIR}"/store-mirror-*.tar.gz 2>/dev/null | tail -n +$((RETENTION_COUNT + 1)) | while IFS= read -r f; do
  [[ -z "${f}" ]] && continue
  rm -f "${f}"
  echo "store-mirror: pruned $(basename "${f}")"
done

echo "store-mirror: SUCCESS -- ${FINAL}"
