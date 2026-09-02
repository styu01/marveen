#!/bin/bash
# Contract tests for main-agent effort resolution in scripts/channels.sh.
#
# Why this exists (EFFORT806, 2026-09-02): .claude/settings.json's "effort"
# key (tracked, "high" since commit c60e030) was silently never reaching the
# running session -- unlike --model, the claude invocation had no
# corresponding --effort flag, so the CLI used its own built-in default
# (medium) regardless of what settings.json said. Found live: the main
# agent's own reported reasoning effort stayed medium-ish while every
# sub-agent (whose launch path DOES pass --effort) correctly ran at "high".
#
# MAIN_AGENT_EFFORT in .env (per-install, gitignored) takes precedence over
# settings.json, mirroring the model resolver's own precedence -- see
# channels-main-model.test.sh for the analogous (and more elaborate, because
# model additionally has a distribution-default fallback that effort
# deliberately does NOT need) contract this one is modeled on.
#
# Driven through `channels.sh --resolve-main-effort`, which prints the
# resolved effort and exits before touching tmux, the store or the network.
# Run: bash scripts/__tests__/channels-main-effort.test.sh

set -u

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 -- expected: $2, got: $3"; }

INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${CHANNELS_BIN:-$INSTALL_DIR/scripts/channels.sh}"

# $1 = label, $2 = .env body, $3 = settings.json body, $4 = expected effort
expect_effort() {
  local label="$1" env_body="$2" settings_body="$3" want="$4"
  local root got
  root="$(mktemp -d)"
  mkdir -p "$root/scripts" "$root/.claude"
  cp "$SRC" "$root/scripts/channels.sh"
  [ -n "$env_body" ] && printf '%s\n' "$env_body" > "$root/.env"
  [ -n "$settings_body" ] && printf '%s\n' "$settings_body" > "$root/.claude/settings.json"
  got="$(bash "$root/scripts/channels.sh" --resolve-main-effort 2>/dev/null | head -1)"
  rm -rf "$root"
  if [ "$got" = "$want" ]; then pass "$label"; else fail "$label" "$want" "$got"; fi
}

echo "channels.sh main-effort resolution"

expect_effort "settings.json alone is honoured" \
  "" '{"effort":"high"}' 'high'

expect_effort ".env wins over settings.json" \
  'MAIN_AGENT_EFFORT=medium' '{"effort":"high"}' 'medium'

expect_effort ".env alone works with no settings.json" \
  'MAIN_AGENT_EFFORT=xhigh' '' 'xhigh'

expect_effort "neither present -> empty, launcher omits --effort (CLI built-in default applies)" \
  "" '' ''

expect_effort "an empty MAIN_AGENT_EFFORT does not shadow settings.json" \
  'MAIN_AGENT_EFFORT=' '{"effort":"max"}' 'max'

# .env carries other keys too; the matcher must be anchored, not a substring
# (same class of bug the model resolver's own test guards against).
expect_effort "a similarly named key does not leak in" \
  'NOT_MAIN_AGENT_EFFORT=wrong-effort
MAIN_AGENT_EFFORT=low' '' 'low'

# settings.json with a model but no effort key -- must not crash or leak the
# model value into the effort resolver.
expect_effort "settings.json with model but no effort key -> empty" \
  "" '{"model":"claude-sonnet-5"}' ''

# THE SHIPPED CONTRACT: unlike model (which is deliberately left unpinned in
# the tracked file so a distribution-default bump can reach every install),
# effort has no such central-bump mechanism and IS meant to ship pinned --
# this just documents that intent and catches an accidental removal.
SHIPPED_SETTINGS="$INSTALL_DIR/.claude/settings.json"
shipped_effort="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("effort") or "")' "$SHIPPED_SETTINGS")"
if [ -n "$shipped_effort" ]; then
  pass "shipped .claude/settings.json pins an effort value ($shipped_effort)"
else
  fail "shipped .claude/settings.json pins an effort value" "(non-empty)" "(empty)"
fi

# The resolver over the REAL shipped settings file must actually surface that
# pinned value -- this is the end-to-end check that would have caught
# EFFORT806 itself (the flag being silently dropped downstream, not the
# resolver being wrong) if it were extended to also grep the launch command;
# kept here as the resolver-level half of that guarantee.
real_settings_effort="$(bash -c '
  root="$(mktemp -d)"; mkdir -p "$root/scripts" "$root/.claude"
  cp "'"$SRC"'" "$root/scripts/channels.sh"
  cp "'"$SHIPPED_SETTINGS"'" "$root/.claude/settings.json"
  bash "$root/scripts/channels.sh" --resolve-main-effort 2>/dev/null | head -1
  rm -rf "$root"
')"
if [ "$real_settings_effort" = "$shipped_effort" ]; then
  pass "resolver over the REAL shipped settings surfaces the pinned effort"
else
  fail "resolver over the REAL shipped settings surfaces the pinned effort" "$shipped_effort" "$real_settings_effort"
fi

# EFFORT806 regression guard: the actual launch command lines must reference
# EFFORT_FLAG, not just define it unused. Grepping the source is the only way
# to catch "resolver correct, but nobody plugged it into the invocation" --
# exactly the bug that shipped for MODEL_FLAG's sibling never happening, but
# IS exactly what happened here (settings.json said "high" for weeks with a
# working resolver concept never wired to the actual claude invocation).
flag_wired_count="$(grep -c 'EFFORT_FLAG}' "$SRC")"
if [ "$flag_wired_count" -ge 2 ]; then
  pass "EFFORT_FLAG is referenced in the launch command (found in $flag_wired_count place(s))"
else
  fail "EFFORT_FLAG is referenced in the launch command" ">=2 occurrences" "$flag_wired_count"
fi

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
