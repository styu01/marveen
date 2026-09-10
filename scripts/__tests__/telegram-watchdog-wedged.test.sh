#!/bin/bash
# Contract tests for telegram_progress_watchdog.py -- the wedged-turn sentry.
# Run: bash scripts/__tests__/telegram-watchdog-wedged.test.sh
#
# Locks the item-(b) fix: when a turn is WEDGED (agent up, but the reply MCP
# call is hung so the turn never ends), the watchdog must (1) react well before
# the 15-min blunt backstop and (2) deliver the agent's REAL answer, not a
# generic error. A legitimately long task (no hung reply) must NOT be touched
# before the backstop.
#
# Fully hermetic: HOME and MARVEEN_ROOT are pinned to a temp tree so the
# watchdog only ever scans test dirs (never the real ~/.claude), and all Bot API
# traffic is routed to a local stub via TELEGRAM_API_BASE.

set -u

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
assert_eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }

INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WATCHDOG="$INSTALL_DIR/scripts/hooks/telegram_progress_watchdog.py"

TMP="$(mktemp -d)"
trap 'kill "$STUB_PID" 2>/dev/null; rm -rf "$TMP"' EXIT

# --- Local Bot API stub (logs "<method> <body>" per request) -----------------
REQLOG="$TMP/requests.log"; PORTFILE="$TMP/port"
cat > "$TMP/stub.py" <<'PYEOF'
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
reqlog = sys.argv[1]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode("utf-8") if n else ""
        method = self.path.rsplit("/", 1)[-1]
        with open(reqlog, "a", encoding="utf-8") as f:
            f.write(f"{method} {body}\n")
        out = {"ok": True, "result": {"message_id": 9001}}
        payload = json.dumps(out).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload))); self.end_headers()
        self.wfile.write(payload)
srv = HTTPServer(("127.0.0.1", 0), H)
with open(sys.argv[2], "w") as f: f.write(str(srv.server_address[1]))
srv.serve_forever()
PYEOF
python3 "$TMP/stub.py" "$REQLOG" "$PORTFILE" &
STUB_PID=$!
for _ in $(seq 1 50); do [ -s "$PORTFILE" ] && break; sleep 0.1; done
PORT="$(cat "$PORTFILE" 2>/dev/null)"
[ -z "$PORT" ] && { echo "FATAL: stub did not start"; exit 1; }
API_BASE="http://127.0.0.1:$PORT"

CHAT="10000000001"
ANSWER="EZ_A_VALODI_VALASZ amit a usernek latnia kell"

# Build a per-case agent state dir + transcript, then return the progress dir.
# kind = hung  -> last tool_use is a Telegram reply with NO result (round hung)
# kind = work  -> last tool_use is a Bash WITH a result (legit long task)
# kind = noans -> hung reply but NO assistant text (nothing to deliver)
make_case() { # name kind age_seconds
    local name="$1" kind="$2" age="$3"
    local pdir="$TMP/root/agents/$name/.claude/channels/telegram/progress"
    local sdir="$TMP/root/agents/$name/.claude/channels/telegram"
    mkdir -p "$pdir"
    printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$sdir/.env"
    local tr="$sdir/transcript.jsonl"
    # created_at pins this entry's OWN age (TGORPHANFILE908) and is ALSO the
    # transcript's own prompt timestamp below (TGORPHANFAILOPEN908: since the
    # whole-file fallback is gone, a transcript with no anchorable prompt is
    # unattributable -- these single-round cases must carry one to still
    # exercise real-answer delivery).
    local created_at prompt_ts
    created_at="$(python3 -c "import time; print(repr(time.time() - $age))")"
    prompt_ts="$(python3 -c "
import datetime
print(datetime.datetime.fromtimestamp($created_at, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'))
")"
    local prompt_ev='{"type":"user","timestamp":"'"$prompt_ts"'","message":{"role":"user","content":"kerdes"}}'
    case "$kind" in
      hung)
        { printf '%s\n' "$prompt_ev";
          printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"'"$ANSWER"'"}]}}';
          printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tuReply1","name":"mcp__plugin_telegram_telegram__reply"}]}}'; } > "$tr" ;;
      noans)
        { printf '%s\n' "$prompt_ev";
          printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tuReply1","name":"mcp__plugin_telegram_telegram__reply"}]}}'; } > "$tr" ;;
      work)
        { printf '%s\n' "$prompt_ev";
          printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"'"$ANSWER"'"},{"type":"tool_use","id":"tuBash1","name":"Bash"}]}}';
          printf '%s\n' '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tuBash1"}]}}'; } > "$tr" ;;
    esac
    python3 - "$pdir/SID.json" "$CHAT" "$tr" "$created_at" <<'PY'
import json, os, sys
path, chat, tr, created_at = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
json.dump([{"chat_id": chat, "message_id": 555, "transcript_path": tr,
            "created_at": created_at}], open(path, "w"))
os.utime(path, (created_at, created_at))
PY
    echo "$pdir"
}
pend_exists() { [ -f "$1/SID.json" ] && echo yes || echo no; }
# REQLOG always exists (recreated per run); grep -c prints exactly one integer
# line ("0" on no match) -- no `|| echo 0` fallback (that would double the 0).
count() { grep -c "^$1 " "$REQLOG" 2>/dev/null; }
body_has() { grep -q "$1" "$REQLOG" && echo yes || echo no; }
run_wd() { # force_up wedged_up_sec
    : > "$REQLOG"
    HOME="$TMP" MARVEEN_ROOT="$TMP/root" TELEGRAM_API_BASE="$API_BASE" \
      TELEGRAM_WATCHDOG_FORCE_AGENT_UP="$1" TELEGRAM_WATCHDOG_WEDGED_UP_SEC="$2" \
      python3 "$WATCHDOG"
}

echo "telegram-watchdog-wedged tests"
echo "=============================="

# ---------------------------------------------------------------------------
# (a) Agent UP + hung reply + past the fast threshold -> deliver REAL answer
# ---------------------------------------------------------------------------
echo ""
echo "(a) Wedged (hung reply): fast, real answer"
PA="$(make_case wa hung 100)"
run_wd 1 1
assert_eq "fires fast: one real-answer sendMessage" "1" "$(count sendMessage)"
assert_eq "delivers the REAL answer text (not a generic error)" "yes" "$(body_has "EZ_A_VALODI_VALASZ")"
assert_eq "clears the placeholder (deleteMessage)" "1" "$(count deleteMessage)"
assert_eq "no generic-error edit" "0" "$(count editMessageText)"
assert_eq "state file removed after handling" "no" "$(pend_exists "$PA")"

# ---------------------------------------------------------------------------
# (b) Agent UP + NO hung reply, before the backstop -> DO NOT touch it
# ---------------------------------------------------------------------------
echo ""
echo "(b) Legit long task (no hung reply): untouched before backstop"
PB="$(make_case wb work 100)"
run_wd 1 1
assert_eq "no delivery for a legitimately working task" "0" "$(count sendMessage)"
assert_eq "no error edit for a working task" "0" "$(count editMessageText)"
assert_eq "placeholder preserved (task still running)" "yes" "$(pend_exists "$PB")"

# ---------------------------------------------------------------------------
# (c) Agent UP + no hung reply but past the 15-min backstop -> fire
# ---------------------------------------------------------------------------
echo ""
echo "(c) Backstop: no hung reply but very old -> fire with real answer"
PC="$(make_case wc work 1000)"   # 1000s > WEDGED_SEC (900)
run_wd 1 1
assert_eq "backstop fires: one delivery" "1" "$(count sendMessage)"
assert_eq "state file removed" "no" "$(pend_exists "$PC")"

# ---------------------------------------------------------------------------
# (d) Agent DOWN + past the down grace -> fire with real answer
# ---------------------------------------------------------------------------
echo ""
echo "(d) Agent down: fire with real answer"
PD="$(make_case wd hung 200)"    # 200s > DOWN_GRACE_SEC (120)
run_wd 0 1
assert_eq "down path fires: one delivery" "1" "$(count sendMessage)"
assert_eq "delivers the real answer" "yes" "$(body_has "EZ_A_VALODI_VALASZ")"

# ---------------------------------------------------------------------------
# (e) Hung reply but NO recoverable answer -> generic error, keep placeholder
# ---------------------------------------------------------------------------
echo ""
echo "(e) Nothing to deliver: falls back to generic error edit"
PE="$(make_case we noans 100)"
run_wd 1 1
assert_eq "no real-answer send (nothing to deliver)" "0" "$(count sendMessage)"
assert_eq "rewrites placeholder into a generic error" "1" "$(count editMessageText)"
assert_eq "error text used" "yes" "$(body_has "Valami elakadt")"

# ---------------------------------------------------------------------------
# TGORPHAN908 cases: stale upper bound + round-scoped answer attribution.
# ---------------------------------------------------------------------------

# Build a case whose transcript carries TIMESTAMPED user prompts (real format).
# layout = delivered | undelivered | foreign
#   delivered:   round-1 prompt @ marker time, answer text + reply call WITH
#                result; then a later internal round with monologue text.
#   undelivered: round-1 prompt @ marker time, answer text, NO reply call;
#                then a later internal round with monologue text.
#   foreign:     only a later round's prompt (nothing at/before marker time).
make_ts_case() { # name layout age_seconds
    local name="$1" layout="$2" age="$3"
    local pdir="$TMP/root/agents/$name/.claude/channels/telegram/progress"
    local sdir="$TMP/root/agents/$name/.claude/channels/telegram"
    mkdir -p "$pdir"
    printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$sdir/.env"
    local tr="$sdir/transcript.jsonl"
    python3 - "$tr" "$layout" "$age" <<'PY'
import datetime, json, sys, time
tr, layout, age = sys.argv[1], sys.argv[2], int(sys.argv[3])
now = time.time()
def iso(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
t1, t2 = now - age, now - age / 2
ev = []
if layout in ("delivered", "undelivered"):
    ev.append({"type": "user", "timestamp": iso(t1),
               "message": {"role": "user", "content": "csatorna-kerdes"}})
    blocks = [{"type": "text", "text": "VALODI_T1_VALASZ a csatornanak"}]
    if layout == "delivered":
        blocks.append({"type": "tool_use", "id": "tuR1",
                       "name": "mcp__plugin_telegram_telegram__reply"})
    ev.append({"type": "assistant", "message": {"role": "assistant", "content": blocks}})
    if layout == "delivered":
        ev.append({"type": "user", "message": {"role": "user",
                   "content": [{"type": "tool_result", "tool_use_id": "tuR1"}]}})
ev.append({"type": "user", "timestamp": iso(t2),
           "message": {"role": "user", "content": "belso scheduled kor"}})
ev.append({"type": "assistant", "message": {"role": "assistant",
           "content": [{"type": "text", "text": "BELSO_NAPLO Szabinak nem kuldtem semmit"}]}})
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
PY
    # created_at pins this entry's OWN age (TGORPHANFILE908); the file's mtime
    # is backdated to match so single-entry cases behave exactly as before.
    python3 - "$pdir/SID.json" "$CHAT" "$tr" "$age" <<'PY'
import json, os, sys, time
path, chat, tr, age = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
created_at = time.time() - age
json.dump([{"chat_id": chat, "message_id": 555, "transcript_path": tr,
            "created_at": created_at}], open(path, "w"))
os.utime(path, (created_at, created_at))
PY
    echo "$pdir"
}

echo ""
echo "(f) Stale (28 days): dropped silently, no API call at all"
PF="$(make_case wf hung $((28 * 86400)))"
run_wd 1 1
assert_eq "no real-answer send for a dead round" "0" "$(count sendMessage)"
assert_eq "no error edit for a dead round" "0" "$(count editMessageText)"
assert_eq "no delete attempt past Telegram's 48h window" "0" "$(count deleteMessage)"
assert_eq "state file removed (cleanup, not collection)" "no" "$(pend_exists "$PF")"

echo ""
echo "(g) Stale but <48h: placeholder deleted, nothing delivered"
PG="$(make_case wg hung 100000)"   # ~27.7h: > 24h stale, < 47h delete window
run_wd 1 1
assert_eq "no real-answer send" "0" "$(count sendMessage)"
assert_eq "no error edit" "0" "$(count editMessageText)"
assert_eq "placeholder deleted while still possible" "1" "$(count deleteMessage)"
assert_eq "state file removed" "no" "$(pend_exists "$PG")"

echo ""
echo "(h) Round's reply already delivered: silent clear, NO resend of anything"
PH="$(make_ts_case wh delivered 1000)"
run_wd 1 1
assert_eq "no resend (answer already reached the channel)" "0" "$(count sendMessage)"
assert_eq "no error edit" "0" "$(count editMessageText)"
assert_eq "internal monologue never sent" "no" "$(body_has "BELSO_NAPLO")"
assert_eq "placeholder cleaned up" "1" "$(count deleteMessage)"
assert_eq "state file removed" "no" "$(pend_exists "$PH")"

echo ""
echo "(i) Answer scoped to the marker's round, not the transcript's last text"
PI="$(make_ts_case wi undelivered 1000)"
run_wd 1 1
assert_eq "backstop fires: one delivery" "1" "$(count sendMessage)"
assert_eq "delivers the marker round's own text" "yes" "$(body_has "VALODI_T1_VALASZ")"
assert_eq "later internal turn's text NOT sent" "no" "$(body_has "BELSO_NAPLO")"
assert_eq "state file removed" "no" "$(pend_exists "$PI")"

echo ""
echo "(j) Timestamped transcript with no prompt at the marker: unattributable"
PJ="$(make_ts_case wj foreign 1000)"
run_wd 1 1
assert_eq "no text delivery (nothing attributable)" "0" "$(count sendMessage)"
assert_eq "internal text NOT leaked" "no" "$(body_has "BELSO_NAPLO")"
assert_eq "falls back to generic error" "1" "$(count editMessageText)"
assert_eq "state file removed" "no" "$(pend_exists "$PJ")"

# ---------------------------------------------------------------------------
# TGORPHANFILE908 cases: one SID.json file holding entries from DIFFERENT
# rounds (the submit hook appends to the same file when an earlier entry is
# still pending) must never let a fresh append mask or contaminate an older
# sibling entry. Each case below builds its own two-entry SID.json + shared
# transcript by hand so the round boundaries are explicit.
# ---------------------------------------------------------------------------

echo ""
echo "(k) Two entries, one file: old orphan fires on its OWN age; a legitimately"
echo "    fresh sibling entry is left pending, and the file is PARTIALLY rewritten"
PK_NAME="wk"
PK_DIR="$TMP/root/agents/$PK_NAME/.claude/channels/telegram/progress"
PK_SDIR="$TMP/root/agents/$PK_NAME/.claude/channels/telegram"
mkdir -p "$PK_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PK_SDIR/.env"
PK_TR="$PK_SDIR/transcript.jsonl"
python3 - "$PK_DIR/SID.json" "$PK_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
old_created, new_created = now - 1000, now - 5   # old > WEDGED_SEC(900), new very fresh
def iso(t):
    import datetime
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
ev = [
    {"type": "user", "timestamp": iso(old_created),
     "message": {"role": "user", "content": "regi kerdes"}},
    # old round: a hung reply call, no assistant text at all -- genuinely
    # nothing of its own to deliver.
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "tool_use", "id": "tuOldReply", "name": "mcp__plugin_telegram_telegram__reply"}]}},
    {"type": "user", "timestamp": iso(new_created),
     "message": {"role": "user", "content": "uj kerdes, meg dolgozik rajta"}},
    # new round: still in progress, nothing emitted yet.
]
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
entries = [
    {"chat_id": chat, "message_id": 555, "transcript_path": tr, "created_at": old_created},
    {"chat_id": chat, "message_id": 777, "transcript_path": tr, "created_at": new_created},
]
json.dump(entries, open(sid_path, "w"))
os.utime(sid_path, (new_created, new_created))  # file mtime = most recent write
PY
run_wd 1 1
assert_eq "old orphan has nothing of its own -> no real-answer send" "0" "$(count sendMessage)"
assert_eq "old orphan resolves via generic error" "1" "$(count editMessageText)"
assert_eq "new (fresh, not hung) entry is untouched -- no delete for it" "0" "$(count deleteMessage)"
assert_eq "file survives (new entry still pending)" "yes" "$(pend_exists "$PK_DIR")"
PK_REMAINING="$(python3 -c "import json; d=json.load(open('$PK_DIR/SID.json')); print(len(d), d[0]['message_id'] if d else '')")"
assert_eq "exactly the new entry (mid=777) remains -- partial rewrite, not wholesale" "1 777" "$PK_REMAINING"

echo ""
echo "(l) Two entries, one file, BOTH fire: each gets ONLY its own round's answer"
PL_NAME="wl"
PL_DIR="$TMP/root/agents/$PL_NAME/.claude/channels/telegram/progress"
PL_SDIR="$TMP/root/agents/$PL_NAME/.claude/channels/telegram"
mkdir -p "$PL_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PL_SDIR/.env"
PL_TR="$PL_SDIR/transcript.jsonl"
python3 - "$PL_DIR/SID.json" "$PL_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
old_created, new_created = now - 1000, now - 10   # old > WEDGED_SEC(900); new > up_sec(1)
def iso(t):
    import datetime
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
ev = [
    {"type": "user", "timestamp": iso(old_created),
     "message": {"role": "user", "content": "regi kerdes"}},
    # old round: its OWN real answer, abandoned (no reply call at all -- the
    # kind of round the wedged-backstop exists to eventually flush).
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "text", "text": "OLD_OWN_ANSWER_zwq"}]}},
    {"type": "user", "timestamp": iso(new_created),
     "message": {"role": "user", "content": "uj kerdes"}},
    # new round: its OWN real answer + a hung reply call (dropped MCP).
    {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "text", "text": "NEW_OWN_ANSWER_xkc"},
        {"type": "tool_use", "id": "tuNewReply", "name": "mcp__plugin_telegram_telegram__reply"},
    ]}},
]
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
entries = [
    {"chat_id": chat, "message_id": 555, "transcript_path": tr, "created_at": old_created},
    {"chat_id": chat, "message_id": 777, "transcript_path": tr, "created_at": new_created},
]
json.dump(entries, open(sid_path, "w"))
os.utime(sid_path, (new_created, new_created))
PY
run_wd 1 1
assert_eq "both entries deliver a real answer" "2" "$(count sendMessage)"
FIRST_SEND="$(grep '^sendMessage ' "$REQLOG" | sed -n '1p')"
SECOND_SEND="$(grep '^sendMessage ' "$REQLOG" | sed -n '2p')"
assert_eq "1st send (old entry) carries its OWN text" "yes" "$(printf '%s' "$FIRST_SEND" | grep -q "OLD_OWN_ANSWER_zwq" && echo yes || echo no)"
assert_eq "1st send (old entry) does NOT carry the new entry's text" "no" "$(printf '%s' "$FIRST_SEND" | grep -q "NEW_OWN_ANSWER_xkc" && echo yes || echo no)"
assert_eq "2nd send (new entry) carries its OWN text" "yes" "$(printf '%s' "$SECOND_SEND" | grep -q "NEW_OWN_ANSWER_xkc" && echo yes || echo no)"
assert_eq "2nd send (new entry) does NOT carry the old entry's text" "no" "$(printf '%s' "$SECOND_SEND" | grep -q "OLD_OWN_ANSWER_zwq" && echo yes || echo no)"
assert_eq "file fully cleared (both entries handled)" "no" "$(pend_exists "$PL_DIR")"

echo ""
echo "(q) Two rounds FIRED IN QUICK SUCCESSION (90s apart, well within the 120s"
echo "    backward slack of EACH OTHER): each entry must still get ONLY its own"
echo "    round's answer (TGORPHANDUP908 -- a single, unambiguous anchor per entry)"
PQ_NAME="wq"
PQ_DIR="$TMP/root/agents/$PQ_NAME/.claude/channels/telegram/progress"
PQ_SDIR="$TMP/root/agents/$PQ_NAME/.claude/channels/telegram"
mkdir -p "$PQ_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PQ_SDIR/.env"
PQ_TR="$PQ_SDIR/transcript.jsonl"
python3 - "$PQ_DIR/SID.json" "$PQ_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
# Both > WEDGED_SEC(900), only 90s apart -- each is within the OTHER's
# +/-120s backward slack, which is exactly the ambiguous case that used to
# let a scope-reset-on-every-match anchor search hand the first round the
# second round's answer.
first_created, second_created = now - 1000, now - 910
def iso(t):
    import datetime
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
ev = [
    {"type": "user", "timestamp": iso(first_created),
     "message": {"role": "user", "content": "elso kerdes"}},
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "text", "text": "FIRST_ONLY_ANSWER_q1w"}]}},
    {"type": "user", "timestamp": iso(second_created),
     "message": {"role": "user", "content": "masodik kerdes, 90mp kesobb"}},
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "text", "text": "SECOND_ONLY_ANSWER_q2e"}]}},
]
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
entries = [
    {"chat_id": chat, "message_id": 555, "transcript_path": tr, "created_at": first_created},
    {"chat_id": chat, "message_id": 777, "transcript_path": tr, "created_at": second_created},
]
json.dump(entries, open(sid_path, "w"))
os.utime(sid_path, (second_created, second_created))
PY
run_wd 1 1
assert_eq "both entries deliver a real answer" "2" "$(count sendMessage)"
Q_FIRST_SEND="$(grep '^sendMessage ' "$REQLOG" | sed -n '1p')"
Q_SECOND_SEND="$(grep '^sendMessage ' "$REQLOG" | sed -n '2p')"
assert_eq "1st send (first entry) carries its OWN text" "yes" "$(printf '%s' "$Q_FIRST_SEND" | grep -q "FIRST_ONLY_ANSWER_q1w" && echo yes || echo no)"
assert_eq "1st send (first entry) does NOT carry the second round's text" "no" "$(printf '%s' "$Q_FIRST_SEND" | grep -q "SECOND_ONLY_ANSWER_q2e" && echo yes || echo no)"
assert_eq "2nd send (second entry) carries its OWN text" "yes" "$(printf '%s' "$Q_SECOND_SEND" | grep -q "SECOND_ONLY_ANSWER_q2e" && echo yes || echo no)"
assert_eq "2nd send (second entry) does NOT carry the first round's text" "no" "$(printf '%s' "$Q_SECOND_SEND" | grep -q "FIRST_ONLY_ANSWER_q1w" && echo yes || echo no)"
assert_eq "file fully cleared (both entries handled)" "no" "$(pend_exists "$PQ_DIR")"

echo ""
echo "(r) Scope must close at the NEXT user prompt even if it has NO timestamp"
echo "    (TGORPHANFAILOPEN908 #1): a later round's internal text must not leak"
PR_NAME="wr"
PR_DIR="$TMP/root/agents/$PR_NAME/.claude/channels/telegram/progress"
PR_SDIR="$TMP/root/agents/$PR_NAME/.claude/channels/telegram"
mkdir -p "$PR_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PR_SDIR/.env"
PR_TR="$PR_SDIR/transcript.jsonl"
python3 - "$PR_DIR/SID.json" "$PR_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
turn_start = now - 1000   # > WEDGED_SEC(900) -> fires
def iso(t):
    import datetime
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
ev = [
    # This entry's own, valid, timestamped anchor -- a hung reply, no text of
    # its own (so a leak would be unambiguous: anything sent came from later).
    {"type": "user", "timestamp": iso(turn_start),
     "message": {"role": "user", "content": "sajat kerdes"}},
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "tool_use", "id": "tuHung", "name": "mcp__plugin_telegram_telegram__reply"}]}},
    # A LATER round's prompt, but WITHOUT a "timestamp" key (mixed/older
    # transcript segment) -- must still close this entry's scope.
    {"type": "user", "message": {"role": "user", "content": "kesobbi kor, timestamp nelkul"}},
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "text", "text": "BELSO_SHOULD_NOT_LEAK_UNTIMESTAMPED908"}]}},
]
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
json.dump([{"chat_id": chat, "message_id": 555, "transcript_path": tr,
            "created_at": turn_start}], open(sid_path, "w"))
os.utime(sid_path, (turn_start, turn_start))
PY
run_wd 1 1
assert_eq "no real-answer send (later round's text must not leak)" "0" "$(count sendMessage)"
assert_eq "the untimestamped round's internal text never leaked" "no" "$(body_has "BELSO_SHOULD_NOT_LEAK_UNTIMESTAMPED908")"
assert_eq "falls back to generic error" "1" "$(count editMessageText)"
assert_eq "state file removed" "no" "$(pend_exists "$PR_DIR")"

echo ""
echo "(s) A per-entry marker whose transcript has NO timestamped prompt AT ALL"
echo "    must fail closed too (TGORPHANFAILOPEN908 #2) -- no whole-file fallback"
PS_NAME="ws"
PS_DIR="$TMP/root/agents/$PS_NAME/.claude/channels/telegram/progress"
PS_SDIR="$TMP/root/agents/$PS_NAME/.claude/channels/telegram"
mkdir -p "$PS_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PS_SDIR/.env"
PS_TR="$PS_SDIR/transcript.jsonl"
# A real, deliverable answer DOES exist -- but with zero timestamped prompts
# in the whole file, this entry (which HAS a created_at) must never reach it.
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"SHOULD_NEVER_BE_SENT_NOTIMESTAMP908"}]}}' > "$PS_TR"
python3 - "$PS_DIR/SID.json" "$PS_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
turn_start = time.time() - 1000   # > WEDGED_SEC(900) -> fires
json.dump([{"chat_id": chat, "message_id": 555, "transcript_path": tr,
            "created_at": turn_start}], open(sid_path, "w"))
os.utime(sid_path, (turn_start, turn_start))
PY
run_wd 1 1
assert_eq "no real-answer send (no timestamped prompt anywhere)" "0" "$(count sendMessage)"
assert_eq "the transcript's real answer never leaked" "no" "$(body_has "SHOULD_NEVER_BE_SENT_NOTIMESTAMP908")"
assert_eq "falls back to generic error" "1" "$(count editMessageText)"
assert_eq "state file removed" "no" "$(pend_exists "$PS_DIR")"

echo ""
echo "(n) Anchor must be CLOSE to turn_start on BOTH sides -- a distant prompt"
echo "    with no near-marker prompt must NOT become the anchor (TGORPHANANCHOR908)"
PN_NAME="wn"
PN_DIR="$TMP/root/agents/$PN_NAME/.claude/channels/telegram/progress"
PN_SDIR="$TMP/root/agents/$PN_NAME/.claude/channels/telegram"
mkdir -p "$PN_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PN_SDIR/.env"
PN_TR="$PN_SDIR/transcript.jsonl"
python3 - "$PN_DIR/SID.json" "$PN_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
turn_start = now - 1000          # > WEDGED_SEC(900) -> this entry fires
distant_prompt = now - 10000     # 9000s before turn_start -- WAY outside +/-120s slack
def iso(t):
    import datetime
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
ev = [
    # The ONLY timestamped prompt in the whole transcript, and it is nowhere
    # near turn_start -- must NOT be adopted as this entry's anchor.
    {"type": "user", "timestamp": iso(distant_prompt),
     "message": {"role": "user", "content": "regen elkezdett, teljesen mas kor"}},
    {"type": "assistant", "message": {"role": "assistant", "content":
        [{"type": "text", "text": "BELSO_SHOULD_NOT_LEAK_ANCHOR908"}]}},
    # No prompt anywhere near turn_start follows -- genuinely unattributable.
]
with open(tr, "w") as f:
    for e in ev:
        f.write(json.dumps(e) + "\n")
json.dump([{"chat_id": chat, "message_id": 555, "transcript_path": tr,
            "created_at": turn_start}], open(sid_path, "w"))
os.utime(sid_path, (turn_start, turn_start))
PY
run_wd 1 1
assert_eq "no real-answer send (distant prompt must not anchor)" "0" "$(count sendMessage)"
assert_eq "the distant round's internal text never leaked" "no" "$(body_has "BELSO_SHOULD_NOT_LEAK_ANCHOR908")"
assert_eq "falls back to generic error (unattributable)" "1" "$(count editMessageText)"
assert_eq "state file removed" "no" "$(pend_exists "$PN_DIR")"

echo ""
echo "(o) Sibling independence at the stale boundary: <48h stale entry gets its"
echo "    placeholder deleted, a fresh sibling in the SAME file is untouched"
PO_NAME="wo"
PO_DIR="$TMP/root/agents/$PO_NAME/.claude/channels/telegram/progress"
PO_SDIR="$TMP/root/agents/$PO_NAME/.claude/channels/telegram"
mkdir -p "$PO_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PO_SDIR/.env"
PO_TR="$PO_SDIR/transcript.jsonl"
: > "$PO_TR"   # no transcript content needed -- the stale path never reads it
python3 - "$PO_DIR/SID.json" "$PO_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
stale_created = now - 100000    # ~27.7h: > STALE_SEC(24h), < delete window(47h)
fresh_created = now - 5         # legitimately still working, not hung
entries = [
    {"chat_id": chat, "message_id": 555, "transcript_path": tr, "created_at": stale_created},
    {"chat_id": chat, "message_id": 777, "transcript_path": tr, "created_at": fresh_created},
]
json.dump(entries, open(sid_path, "w"))
os.utime(sid_path, (fresh_created, fresh_created))
PY
run_wd 1 1
assert_eq "no real-answer send for the stale entry" "0" "$(count sendMessage)"
assert_eq "no generic-error edit either (pure stale-drop)" "0" "$(count editMessageText)"
assert_eq "stale placeholder deleted (still within the 48h window)" "1" "$(count deleteMessage)"
assert_eq "file survives (fresh sibling still pending)" "yes" "$(pend_exists "$PO_DIR")"
PO_REMAINING="$(python3 -c "import json; d=json.load(open('$PO_DIR/SID.json')); print(len(d), d[0]['message_id'] if d else '')")"
assert_eq "exactly the fresh entry (mid=777) remains" "1 777" "$PO_REMAINING"

echo ""
echo "(p) Sibling independence past the delete window: >47h stale entry is"
echo "    dropped with NO API call at all, a fresh sibling is still untouched"
PP_NAME="wp"
PP_DIR="$TMP/root/agents/$PP_NAME/.claude/channels/telegram/progress"
PP_SDIR="$TMP/root/agents/$PP_NAME/.claude/channels/telegram"
mkdir -p "$PP_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PP_SDIR/.env"
PP_TR="$PP_SDIR/transcript.jsonl"
: > "$PP_TR"
python3 - "$PP_DIR/SID.json" "$PP_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
now = time.time()
ancient_created = now - (28 * 86400)   # 28 days: past the 47h delete window too
fresh_created = now - 5
entries = [
    {"chat_id": chat, "message_id": 555, "transcript_path": tr, "created_at": ancient_created},
    {"chat_id": chat, "message_id": 777, "transcript_path": tr, "created_at": fresh_created},
]
json.dump(entries, open(sid_path, "w"))
os.utime(sid_path, (fresh_created, fresh_created))
PY
run_wd 1 1
assert_eq "no real-answer send for the ancient entry" "0" "$(count sendMessage)"
assert_eq "no generic-error edit either" "0" "$(count editMessageText)"
assert_eq "no delete attempt past the 48h window" "0" "$(count deleteMessage)"
assert_eq "file survives (fresh sibling still pending)" "yes" "$(pend_exists "$PP_DIR")"
PP_REMAINING="$(python3 -c "import json; d=json.load(open('$PP_DIR/SID.json')); print(len(d), d[0]['message_id'] if d else '')")"
assert_eq "exactly the fresh entry (mid=777) remains" "1 777" "$PP_REMAINING"

echo ""
echo "(m) Legacy entry (no created_at, pre-TGORPHANFILE908 format): fail-closed"
PM_NAME="wm"
PM_DIR="$TMP/root/agents/$PM_NAME/.claude/channels/telegram/progress"
PM_SDIR="$TMP/root/agents/$PM_NAME/.claude/channels/telegram"
mkdir -p "$PM_DIR"
printf 'TELEGRAM_BOT_TOKEN=TESTTOKEN\n' > "$PM_SDIR/.env"
PM_TR="$PM_SDIR/transcript.jsonl"
# A real, deliverable answer DOES exist in the transcript -- the point of this
# case is that a legacy (no created_at) entry must NEVER reach it.
printf '%s\n' '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"SHOULD_NEVER_BE_SENT_LEGACY"}]}}' > "$PM_TR"
python3 - "$PM_DIR/SID.json" "$PM_TR" "$CHAT" <<'PY'
import json, os, sys, time
sid_path, tr, chat = sys.argv[1], sys.argv[2], sys.argv[3]
old_mtime = time.time() - 1000  # > WEDGED_SEC(900) via file-age fallback
json.dump([{"chat_id": chat, "message_id": 555, "transcript_path": tr}], open(sid_path, "w"))
os.utime(sid_path, (old_mtime, old_mtime))
PY
run_wd 1 1
assert_eq "legacy entry NEVER gets a scraped real answer" "0" "$(count sendMessage)"
assert_eq "legacy entry resolves via generic error only" "1" "$(count editMessageText)"
assert_eq "the transcript's real answer text never leaked" "no" "$(body_has "SHOULD_NEVER_BE_SENT_LEGACY")"
assert_eq "state file removed" "no" "$(pend_exists "$PM_DIR")"

# ---------------------------------------------------------------------------
echo ""
echo "=============================="
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then echo "FAILED: $FAIL tests"; exit 1; fi
echo "All tests passed."
