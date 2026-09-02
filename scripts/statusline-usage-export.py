#!/usr/bin/env python3
"""
statusline-usage-export.py -- Claude Code statusLine script.

Wire this up as `statusLine.command` in a DEDICATED tracker session's
settings.json (see docs/statusline-usage-tracker-dev-spec-20260901.md for
why it must be a dedicated, non-critical session, not any fleet-critical
one). Claude Code invokes it on every status-line update (message received,
tool completes, a refreshInterval timer, etc.) and feeds it the current
session's JSON on stdin, including (once at least one real API response has
landed in the session) a `rate_limits` block with the SAME five_hour/
seven_day utilization the account's real usage genuinely is at -- sourced
from the normal inference response, not the separate /api/oauth/usage
endpoint that 403s for a setup-token-scoped fleet token (see
docs/usage-percent-oauth-scope-root-cause-20260901.md). This sidesteps that
scope restriction entirely: no extra API call, no extra scope needed, just
reading data Claude Code already received.

IMPORTANT -- refreshInterval does NOT fetch fresh data (Codex review,
2026-09-01, see dev-spec section 8.3): it only re-runs THIS SCRIPT on a
timer with the session's LAST KNOWN state. rate_limits only changes after a
real API response, and the stdin payload carries NO field indicating why a
given invocation fired (confirmed against the official docs -- no
trigger/reason key exists) and NO server-side "as-of" timestamp for the
rate_limits numbers themselves. So this script cannot tell "a genuine new
turn just happened" apart from "I was re-invoked with the same old state"
except by comparing values to what it already has on disk.

Each WINDOW carries its OWN `collected_at_unix` (Codex review round 3,
2026-09-01 -- confirmed by BÉLA independently re-reading this file): an
earlier version stamped ONE shared timestamp on the whole merged snapshot,
which let a stale window silently ride to "fresh" under a sibling window's
timestamp whenever a partial payload (only one primary window validly
parsed this invocation) triggered a write. Per-window timestamps mean
usage-collect.py's trust gate can -- and must -- check each required
window's OWN age independently rather than one file-level age.

Known, accepted tradeoff (documented, not "fixed" -- there is no clean fix
without an out-of-band signal the payload doesn't provide, verified against
the docs, not assumed): a window's timestamp only advances when its VALUE
changes. If a genuinely fresh real turn reports the exact same rounded
percentage as the previous real turn, this script has no way to know that
and will NOT advance the timestamp -- the cache can appear stale even
though the tracker is working correctly. This is deliberate: the failure
mode is "falls back to a worse source unnecessarily" (safe), never "serves
a stale number as if fresh" (unsafe). See dev-spec section 8.6 for why this
wasn't engineered around with a new signal.

Writes ONLY to store/usage-statusline-latest.json (absolute path, resolved
from this script's own real location, independent of the caller's cwd --
Claude Code's statusLine command must still be configured with an ABSOLUTE
command path in settings.json; see the dev-spec's settings.json example).
Deliberately a SEPARATE file from store/usage-latest.json, which the
independent usage-collect.py cron (every 5 min) fully overwrites on its own
schedule -- writing directly to usage-latest.json here would race that cron
job. usage-collect.py reads this file (if both primary windows are present,
valid, AND individually fresh) as a higher-priority source ahead of its own
network fetch -- see _read_statusline_cache() there.

File permissions: chmod 0600 after write. This is account-level usage data
(exact quota consumption), not a host secret, but there's no reason for it
to be group/world-readable either.

Single-writer: a flock-based lock (non-blocking) around the read-compare-
write sequence. Claude Code cancels an in-flight statusLine script run when
a new trigger fires before the previous one finished -- our own tmp+rename
write is atomic regardless, but the lock additionally protects the read-
compare-write sequence (which spans more than the write alone) against a
genuinely overlapping second invocation (e.g. a misconfiguration pointing
two sessions at the same store dir). If the lock is held, this run skips its
own write silently (the existing cache is left exactly as it was) --
correctness over completeness.

Hard timeout: SIGALRM-based, TIMEOUT_SECONDS wall-clock. There is no network
I/O in this script, so a hang should be impossible, but Claude Code itself
enforces a limit on a status-line script and this is a second, defensive
one so a hang reads as "script timed out" (a clear signal in the output)
rather than an indefinitely blocked terminal.

Never raises past main(): a status-line script crashing shows as a blank or
broken status line in the actual terminal. Always prints SOMETHING to
stdout (that becomes the rendered status line text), even on missing/
malformed input, a stale cache, a lock miss, or a timeout.
"""

import errno
import json
import os
import signal
import sys
import time

try:
    import fcntl
except ImportError:  # pragma: no cover -- POSIX-only script (fleet runs Linux/macOS)
    fcntl = None

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
STORE_DIR = os.path.join(REPO_ROOT, "store")
OUT_PATH = os.path.join(STORE_DIR, "usage-statusline-latest.json")
LOCK_PATH = OUT_PATH + ".lock"
TIMEOUT_SECONDS = 3

# Only the two windows usage-collect.py's trust gate actually requires are
# validated strictly by name here; seven_day_opus/seven_day_sonnet are
# opportunistic extras (NOT documented top-level rate_limits sub-fields as
# of 2026-09-01, per a direct re-fetch of the official statusline docs --
# only five_hour/seven_day/spend_limit are documented -- feature-detected,
# not guaranteed stable) and pass through with the same per-field
# validation but never block anything if absent or malformed.
PRIMARY_KEYS = ("five_hour", "seven_day")
OPTIONAL_KEYS = ("seven_day_opus", "seven_day_sonnet")


class _Timeout(Exception):
    pass


def _alarm_handler(signum, frame):
    raise _Timeout()


def _pct(window):
    """Strict: a real, finite percentage in [0, 100]. Only the documented
    `used_percentage` key is accepted. `utilization` (the /api/oauth/usage
    field name) was tolerated here before this hardening pass and is
    deliberately dropped: it is NOT a documented statusLine field, and if
    Anthropic ever adds it here there is no confirmed evidence it would be
    on the same 0-100 scale rather than /api/oauth/usage's fractional-vs-
    percentage ambiguity (Codex review, 2026-09-01) -- accepting an
    unverified alt-key risks silently mixing scales into an absurd number.
    Only widen this once a real statusLine payload confirms the shape."""
    if not isinstance(window, dict):
        return None
    v = window.get("used_percentage")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if not (0 <= v <= 100):
        return None
    return v


def _resets_at(window):
    """Strict: a positive unix-epoch number. The statusLine payload gives
    this as a number already (unlike /api/oauth/usage's ISO-8601 string) --
    tolerate a numeric string defensively, reject anything non-positive
    (an epoch of 0 or negative is never a real future/recent reset time)."""
    if not isinstance(window, dict):
        return None
    v = window.get("resets_at")
    if isinstance(v, str):
        try:
            v = float(v)
        except ValueError:
            return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if v <= 0:
        return None
    return v


def _parse_windows(rate_limits):
    windows = {}
    for key in PRIMARY_KEYS + OPTIONAL_KEYS:
        w = rate_limits.get(key)
        pct = _pct(w)
        if pct is None:
            continue
        windows[key] = {"used_percent": pct, "resets_at": _resets_at(w)}
    return windows


def _value_equal(a, b):
    """True iff two single-window dicts carry the same used_percent AND
    resets_at (collected_at_unix is deliberately excluded from this
    comparison -- it's the thing being decided, not an input to the
    decision)."""
    return (
        a.get("used_percent") == b.get("used_percent")
        and a.get("resets_at") == b.get("resets_at")
    )


def _read_existing_windows():
    """Returns the existing windows dict (each entry already carrying its
    own collected_at_unix), or {} if the file is absent/unreadable/in the
    old shared-timestamp schema (a stale collected_at_unix wouldn't be
    trustworthy under the new per-window contract anyway -- treat it as
    "nothing known" rather than try to migrate it)."""
    try:
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    windows = data.get("windows")
    if not isinstance(windows, dict):
        return {}
    out = {}
    for k, w in windows.items():
        if isinstance(w, dict) and isinstance(w.get("collected_at_unix"), (int, float)):
            out[k] = w
    return out


def _acquire_lock():
    """Non-blocking flock. Returns an open file handle (keep it referenced
    for the lock's lifetime) on success, None if already held or fcntl is
    unavailable (platform without flock -- fail open, single-writer safety
    becomes best-effort rather than a hard requirement in that case)."""
    if fcntl is None:
        return None
    fh = None
    try:
        os.makedirs(STORE_DIR, exist_ok=True)
        fh = open(LOCK_PATH, "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fh
    except OSError as e:
        if fh is not None:
            fh.close()
        if e.errno in (errno.EACCES, errno.EAGAIN):
            return "locked"
        return None
    except Exception:
        if fh is not None:
            fh.close()
        return None


def _write_snapshot(windows):
    tmp_path = OUT_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": "statusline",
                "status": "ok",
                "file_written_at_unix": time.time(),  # informational only -- NOT used for
                                                        # freshness decisions, see per-window
                                                        # collected_at_unix instead.
                "windows": windows,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    os.replace(tmp_path, OUT_PATH)
    try:
        os.chmod(OUT_PATH, 0o600)
    except OSError:
        pass


def _run():
    raw = sys.stdin.read()
    try:
        data = json.loads(raw)
    except Exception:
        print("usage: (bad stdin)")
        return 0

    if not isinstance(data, dict):
        print("usage: (bad stdin)")
        return 0

    rate_limits = data.get("rate_limits")
    if not isinstance(rate_limits, dict):
        # Normal before the session's first real API response -- not an
        # error, just nothing to export yet.
        print("usage: pending first response")
        return 0

    parsed = _parse_windows(rate_limits)
    if not any(k in parsed for k in PRIMARY_KEYS):
        # Neither primary window parsed -- usage-collect.py's trust gate
        # requires both anyway, so there's nothing useful to persist yet.
        print("usage: rate_limits present but no valid five_hour/seven_day")
        return 0

    lock = _acquire_lock()
    if lock == "locked":
        # Another invocation is mid-write (should be rare -- Claude Code
        # normally serializes these itself). Don't fight it; report from
        # whatever is already on disk instead of writing.
        print("usage: (lock held, skipped this update)")
        return 0

    try:
        existing = _read_existing_windows()
        now = time.time()
        merged = dict(existing)
        changed = False
        for key, w in parsed.items():
            prior = existing.get(key)
            if prior is None or not _value_equal(prior, w):
                merged[key] = {
                    "used_percent": w["used_percent"],
                    "resets_at": w["resets_at"],
                    "collected_at_unix": now,
                }
                changed = True
            # else: value unchanged from what's on disk -- keep the prior
            # entry (and its OLDER timestamp) untouched. This is the
            # per-window version of the freshness-preserving fix: this
            # specific window's data is not demonstrably new, so its
            # timestamp must not advance, even though OTHER windows in
            # this same merged write might genuinely be new.

        if changed:
            _write_snapshot(merged)
    finally:
        if lock not in (None, "locked"):
            try:
                if fcntl is not None:
                    fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
                lock.close()
            except Exception:
                pass

    five_h = parsed.get("five_hour", {}).get("used_percent")
    seven_d = parsed.get("seven_day", {}).get("used_percent")
    five_h_txt = f"{five_h}%" if five_h is not None else "?"
    seven_d_txt = f"{seven_d}%" if seven_d is not None else "?"
    print(f"usage 5h:{five_h_txt} 7d:{seven_d_txt}")
    return 0


def main():
    if fcntl is not None:  # SIGALRM needs a POSIX signal handler
        signal.signal(signal.SIGALRM, _alarm_handler)
        signal.alarm(TIMEOUT_SECONDS)
    try:
        return _run()
    except _Timeout:
        print("usage: (timed out)")
        return 0
    except Exception:
        # Never let an unexpected error break the status line's own stdout.
        print("usage: (internal error)")
        return 0
    finally:
        if fcntl is not None:
            signal.alarm(0)


if __name__ == "__main__":
    sys.exit(main())
