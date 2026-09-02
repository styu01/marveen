#!/usr/bin/env python3
"""Unit tests for scripts/statusline-usage-export.py.

Covers the pure-logic pieces (_pct/_resets_at validation, _value_equal)
directly, and _run() end-to-end via stdin/stdout capture with OUT_PATH/
LOCK_PATH patched to a scratch tempdir -- never touches the real
store/usage-statusline-latest.json.
"""
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

_MODULE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "statusline-usage-export.py",
)

_spec = importlib.util.spec_from_file_location("statusline_usage_export", _MODULE_PATH)
sle = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(sle)  # type: ignore[union-attr]


class TestPct(unittest.TestCase):
    def test_valid_int(self):
        self.assertEqual(sle._pct({"used_percentage": 42}), 42)

    def test_valid_float(self):
        self.assertEqual(sle._pct({"used_percentage": 42.5}), 42.5)

    def test_boundary_zero_and_hundred_accepted(self):
        self.assertEqual(sle._pct({"used_percentage": 0}), 0)
        self.assertEqual(sle._pct({"used_percentage": 100}), 100)

    def test_out_of_range_rejected(self):
        self.assertIsNone(sle._pct({"used_percentage": 150}))
        self.assertIsNone(sle._pct({"used_percentage": -1}))

    def test_bool_rejected(self):
        """bool is an int subclass in Python -- must not sneak through."""
        self.assertIsNone(sle._pct({"used_percentage": True}))
        self.assertIsNone(sle._pct({"used_percentage": False}))

    def test_non_numeric_rejected(self):
        self.assertIsNone(sle._pct({"used_percentage": "42"}))
        self.assertIsNone(sle._pct({"used_percentage": None}))

    def test_utilization_alt_key_NOT_tolerated(self):
        """Codex review, 2026-09-01: dropped deliberately -- unverified
        scale (0-1 vs 0-100) for this specific payload shape, unlike the
        /api/oauth/usage endpoint's own 'utilization' field."""
        self.assertIsNone(sle._pct({"utilization": 42}))

    def test_not_a_dict(self):
        self.assertIsNone(sle._pct("not a dict"))
        self.assertIsNone(sle._pct(None))


class TestResetsAt(unittest.TestCase):
    def test_valid_number(self):
        self.assertEqual(sle._resets_at({"resets_at": 1788300000}), 1788300000)

    def test_valid_numeric_string(self):
        self.assertEqual(sle._resets_at({"resets_at": "1788300000"}), 1788300000.0)

    def test_zero_or_negative_rejected(self):
        self.assertIsNone(sle._resets_at({"resets_at": 0}))
        self.assertIsNone(sle._resets_at({"resets_at": -5}))

    def test_bool_rejected(self):
        self.assertIsNone(sle._resets_at({"resets_at": True}))

    def test_unparseable_string_rejected(self):
        self.assertIsNone(sle._resets_at({"resets_at": "soon"}))

    def test_missing_key(self):
        self.assertIsNone(sle._resets_at({}))


class TestValueEqual(unittest.TestCase):
    """_value_equal() compares a SINGLE window's used_percent/resets_at
    (collected_at_unix deliberately excluded -- it's the output of the
    freshness decision, not an input to it). Per-window, not whole-snapshot,
    since Codex review round 3 (2026-09-01) moved timestamps to per-window
    granularity -- see the module docstring and dev-spec section 8.6."""

    def test_identical_true(self):
        a = {"used_percent": 30, "resets_at": 100, "collected_at_unix": 111}
        b = {"used_percent": 30, "resets_at": 100, "collected_at_unix": 222}
        self.assertTrue(sle._value_equal(a, b))  # collected_at_unix differing doesn't matter

    def test_different_percent_false(self):
        a = {"used_percent": 30, "resets_at": 100}
        b = {"used_percent": 31, "resets_at": 100}
        self.assertFalse(sle._value_equal(a, b))

    def test_different_resets_at_false(self):
        a = {"used_percent": 30, "resets_at": 100}
        b = {"used_percent": 30, "resets_at": 200}
        self.assertFalse(sle._value_equal(a, b))


class TestRunEndToEnd(unittest.TestCase):
    """_run() with OUT_PATH/LOCK_PATH/STORE_DIR redirected to a scratch
    tempdir and stdin/stdout captured -- never touches the real store/."""

    def setUp(self):
        self._dir = tempfile.mkdtemp(prefix="statusline-export-test-")
        self._out_path = os.path.join(self._dir, "usage-statusline-latest.json")
        self._patches = [
            patch.object(sle, "STORE_DIR", self._dir),
            patch.object(sle, "OUT_PATH", self._out_path),
            patch.object(sle, "LOCK_PATH", self._out_path + ".lock"),
        ]
        for p in self._patches:
            p.start()
            self.addCleanup(p.stop)

    def _run_with_stdin(self, payload_str):
        with patch.object(sys, "stdin", io.StringIO(payload_str)), \
             patch.object(sys, "stdout", io.StringIO()) as out:
            rc = sle._run()
        return rc, out.getvalue()

    def _read_out(self):
        with open(self._out_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def test_fresh_payload_writes_file(self):
        payload = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 30, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        rc, out = self._run_with_stdin(payload)
        self.assertEqual(rc, 0)
        self.assertIn("5h:30%", out)
        self.assertIn("7d:4%", out)
        snap = self._read_out()
        self.assertEqual(snap["status"], "ok")
        self.assertEqual(snap["windows"]["five_hour"]["used_percent"], 30)
        self.assertIsInstance(snap["windows"]["five_hour"]["collected_at_unix"], (int, float))
        self.assertIsInstance(snap["windows"]["seven_day"]["collected_at_unix"], (int, float))
        self.assertEqual(os.stat(self._out_path).st_mode & 0o777, 0o600)

    def test_identical_second_run_preserves_timestamp(self):
        """The core fix for Codex's release-blocker 1: refreshInterval
        re-runs this script with the session's LAST KNOWN (possibly stale)
        state, not fresh data. A repeat of the exact same values must NOT
        bump either window's collected_at_unix, or usage-collect.py's
        staleness gate would be fooled into treating old numbers as newly
        confirmed."""
        payload = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 30, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        self._run_with_stdin(payload)
        snap1 = self._read_out()["windows"]
        self._run_with_stdin(payload)
        snap2 = self._read_out()["windows"]
        self.assertEqual(snap1["five_hour"]["collected_at_unix"], snap2["five_hour"]["collected_at_unix"])
        self.assertEqual(snap1["seven_day"]["collected_at_unix"], snap2["seven_day"]["collected_at_unix"])

    def test_changed_payload_bumps_timestamp(self):
        payload1 = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 30, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        payload2 = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 31, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        self._run_with_stdin(payload1)
        t1 = self._read_out()["windows"]["five_hour"]["collected_at_unix"]
        self._run_with_stdin(payload2)
        snap2 = self._read_out()
        self.assertGreaterEqual(snap2["windows"]["five_hour"]["collected_at_unix"], t1)
        self.assertEqual(snap2["windows"]["five_hour"]["used_percent"], 31)

    def test_partial_update_merges_not_overwrites(self):
        """A run that only sees one valid primary window (e.g. seven_day
        temporarily missing/invalid in that particular stdin payload) must
        not erase a previously-known seven_day value."""
        payload_full = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 30, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        self._run_with_stdin(payload_full)

        payload_partial = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 33, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 999},  # out of range -> invalid
            }
        })
        self._run_with_stdin(payload_partial)
        snap = self._read_out()
        self.assertEqual(snap["windows"]["five_hour"]["used_percent"], 33)
        # seven_day survives from the prior write, not clobbered by the
        # invalid value in this run.
        self.assertEqual(snap["windows"]["seven_day"]["used_percent"], 4)

    def test_partial_update_does_not_advance_the_untouched_windows_timestamp(self):
        """Codex review round 3 (2026-09-01), confirmed by BÉLA independently
        re-reading the code -- the exact release-blocker scenario: a partial
        payload that only re-validates ONE window must NOT stamp a fresh
        timestamp on the OTHER, carried-over window. The old (pre-fix)
        behavior wrote ONE shared collected_at_unix for the whole merged
        snapshot whenever ANYTHING changed, so seven_day's genuinely-old
        value would silently look just-as-fresh as five_hour's genuinely-new
        one. This is the test that would have caught it."""
        payload_full = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 30, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        self._run_with_stdin(payload_full)
        t0_seven_day = self._read_out()["windows"]["seven_day"]["collected_at_unix"]

        # Only five_hour validly parses this round -- seven_day is entirely
        # absent from rate_limits this invocation (not just out of range).
        payload_partial = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 33, "resets_at": 1788300000},
            }
        })
        self._run_with_stdin(payload_partial)
        snap = self._read_out()

        self.assertEqual(snap["windows"]["five_hour"]["used_percent"], 33)
        self.assertGreaterEqual(snap["windows"]["five_hour"]["collected_at_unix"], t0_seven_day)

        # The regression check: seven_day's value is carried over (30->4
        # unchanged) AND -- critically -- its OWN timestamp must be
        # IDENTICAL to the original write, not bumped just because this
        # invocation touched the file for five_hour's sake.
        self.assertEqual(snap["windows"]["seven_day"]["used_percent"], 4)
        self.assertEqual(snap["windows"]["seven_day"]["collected_at_unix"], t0_seven_day)

    def test_bad_json_stdin(self):
        rc, out = self._run_with_stdin("not json")
        self.assertEqual(rc, 0)
        self.assertIn("bad stdin", out)
        self.assertFalse(os.path.exists(self._out_path))

    def test_no_rate_limits_key(self):
        rc, out = self._run_with_stdin(json.dumps({"model": "sonnet"}))
        self.assertEqual(rc, 0)
        self.assertIn("pending first response", out)
        self.assertFalse(os.path.exists(self._out_path))

    def test_neither_primary_window_valid(self):
        payload = json.dumps({"rate_limits": {"five_hour": {"used_percentage": 500}}})
        rc, out = self._run_with_stdin(payload)
        self.assertEqual(rc, 0)
        self.assertIn("no valid five_hour/seven_day", out)
        self.assertFalse(os.path.exists(self._out_path))

    def test_lock_held_skips_write(self):
        payload = json.dumps({
            "rate_limits": {
                "five_hour": {"used_percentage": 30, "resets_at": 1788300000},
                "seven_day": {"used_percentage": 4, "resets_at": 1788800000},
            }
        })
        if sle.fcntl is None:
            self.skipTest("fcntl unavailable on this platform")
        os.makedirs(self._dir, exist_ok=True)
        lock_fh = open(self._out_path + ".lock", "w")
        sle.fcntl.flock(lock_fh.fileno(), sle.fcntl.LOCK_EX | sle.fcntl.LOCK_NB)
        try:
            rc, out = self._run_with_stdin(payload)
            self.assertEqual(rc, 0)
            self.assertIn("lock held", out)
            self.assertFalse(os.path.exists(self._out_path))
        finally:
            sle.fcntl.flock(lock_fh.fileno(), sle.fcntl.LOCK_UN)
            lock_fh.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
