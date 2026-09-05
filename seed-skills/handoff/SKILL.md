---
name: handoff
description: Generate a HANDOFF.md context transfer document for session continuity. Use when switching sessions, handing off to another agent, or preserving complex task context before a context window reset. Trigger on "/handoff" command or "handoff:" prefix in inter-agent messages.
---

# Handoff -- Session Context Transfer

## When to use

- You are about to hit context limits and need to preserve task state
- A task needs to continue in a fresh session (yours or another agent's)
- Inter-agent delegation of a complex, multi-step task
- User explicitly says `/handoff` or asks to "save context for later"
- Before a `/checkpoint` when the task is too complex for 3-5 bullet points

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `purpose` | YES | What the next session should do with this context |
| `target` | no | Agent name (e.g. `target=dev2`) -- sends via inter-agent message instead of writing file |
| `output` | no | File path override (default: project root `HANDOFF.md`) |

Examples:
- `/handoff purpose="Continue the Pipedrive connector PR review and address CI failures"`
- `/handoff purpose="Finish the scheduler forceSend implementation" target=dev2`
- `/handoff purpose="Debug the auth redirect loop" output=/tmp/handoff-auth.md`

## Procedure

### 1. Gather context

Collect data from these sources (skip any that return empty):

```bash
# Active kanban cards (assigned to current agent or recently touched).
# Via the dashboard API, NOT the sqlite3 CLI: sqlite3 (and jq) are absent on a
# stock Linux install -- measured on two live hosts 2026-08-04, where the CLI
# call died with exit 127 while python3 was present on both.
AGENT_ID="$(echo $BOT_NAME | tr '[:upper:]' '[:lower:]')"
PORT="$(sed -n 's/^WEB_PORT=//p' .env 2>/dev/null | head -1 | tr -d '"')"; PORT="${PORT:-3420}"
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  "http://localhost:$PORT/api/kanban" | AGENT_ID="$AGENT_ID" python3 -c "
import json,os,sys
me=os.environ.get('AGENT_ID','')
rows=[c for c in json.load(sys.stdin)
      if not c.get('archived_at') and ((c.get('assignee') or '').lower()==me or c.get('status')=='in_progress')]
rank={'urgent':0,'high':1,'normal':2,'low':3}
rows.sort(key=lambda c:(rank.get(c.get('priority'),9), -(c.get('updated_at') or 0)))
for c in rows[:10]:
    print(c['id'], '|', c.get('status'), '|', c.get('priority'), '|', (c.get('assignee') or '-'), '|', c.get('title'))
"

# Hot memories from last 24h
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  "http://localhost:$PORT/api/memories?agent=$AGENT_ID&category=hot&limit=10"

# Recent warm memories (project context)
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  "http://localhost:$PORT/api/memories?agent=$AGENT_ID&category=warm&limit=5"

# Today's daily log
DATE=$(date +%Y-%m-%d)
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  "http://localhost:$PORT/api/daily-log?agent=$AGENT_ID&date=$DATE"

# SONWIN905 (2026-09-05): up to the 10 most recent inter-agent threads THIS
# agent dispatched that have NOT been closed done/failed yet -- id, recipient,
# how long ago. This is NOT proof no reply ever came (a reply can arrive as a
# separate new message without the original dispatch ever being closed) --
# treat it as "still-open dispatched threads", not "confirmed no answer".
# Feeds the "Inter-agent Waiting Threads" section below. Deliberately NOT the
# same as /api/messages?agent=$AGENT_ID (that is the agent's whole MAILBOX,
# both directions) or /api/messages/backlog (INBOUND queue depth) -- this is
# OUTBOUND only, the specific question a resumed session needs answered:
# "which of my own dispatched requests are still open".
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  "http://localhost:$PORT/api/messages/waiting-outbound?agent=$AGENT_ID&limit=10"
```

Also include from your current conversation context:
- The last significant user/peer messages and decisions
- Any error patterns or debugging findings
- File paths and line numbers you were working on
- Git branch, uncommitted changes, open PRs

### 2. Generate HANDOFF.md

Structure with AT LEAST the following 7 sections, in this order. "At least"
is deliberate, not a loophole: every section below is part of the baseline,
not an optional extra -- a handoff that skips one because "nothing to report"
should still include it and say so explicitly (see Pitfalls). Add MORE
sections only when the specific task genuinely needs them (e.g. a large
migration might warrant its own "Rollback Plan" section) -- do not silently
drop any of the 7.

```markdown
# Handoff: {purpose}

Generated: {ISO timestamp}
From: {agent name}
To: {target agent or "next session"}

## Goal
{What the overall task is trying to accomplish. 2-3 sentences max.}

## Current Progress
{What has been done so far. Bullet list with specifics:
- File paths changed
- PRs opened (with URLs)
- Kanban card IDs and their status
- Key decisions made}

## What Worked
{Approaches, tools, or patterns that succeeded:
- Specific commands or API calls that gave good results
- Architecture decisions that held up
- Workarounds that solved blockers}

## What Didn't Work
{Dead ends, failed approaches, gotchas:
- Commands or approaches that failed and WHY
- Assumptions that turned out wrong
- Edge cases discovered}

## Next Steps
{Concrete, actionable items for the receiving session:
1. First thing to do (most specific)
2. Second thing
3. ...
Keep each step concrete enough to execute without asking questions.}

## Open Questions
{SONWIN905 (2026-09-05): two DIFFERENTLY-SHAPED kinds of "not decided yet" --
conflating them is the most common way a resumed session re-opens something
that was already in motion, or conversely sits idle on something nobody else
is actually working on. Keep them as two separate lists, even when one is empty:

- **Dispatched, not yet closed**: a question or task sent to someone else
  (another agent, the user) that has not been resolved yet. Name WHO it went
  to and roughly WHEN. "Not yet closed" is not the same claim as "definitely
  no reply came" -- a reply can arrive as a separate message without the
  original dispatch ever being marked resolved, so check the actual
  conversation before writing this up as unanswered. The Inter-agent Waiting
  Threads section below only lists the latest `limit` (10) rows, not every
  open dispatch ever sent -- if an inter-agent item here appears among those
  returned rows, cross-reference it below ("see thread #1234 below") instead
  of describing the same open item twice with no link between the two; if it
  does not appear there (older than the last 10), it still belongs here.
- **Left open for myself**: a decision THIS session deliberately did not
  make -- needs more information, needs the user's judgment call, or was cut
  short by context/time running out. Nobody else is going to resolve this;
  the next session (or the user) has to.

State "none" explicitly for either list if empty -- an omitted list reads as
"nobody checked", not as "there were none".}

## Inter-agent Waiting Threads
{SONWIN905 (2026-09-05): the up-to-10 most recent NOT-YET-CLOSED outbound
threads from the `waiting-outbound` query in step 1 -- concrete, not vague,
but also not exhaustive (only the most recent `limit` rows; say so if the
kanban/memory context suggests there may be more open than that). For each
row, report ONLY what the API actually returns -- the message id, who it was
sent to, and how long ago (compute from `created_at`, a Unix-epoch-seconds
field, against the current time) -- do NOT invent detail the response does
not contain (e.g. what the thread is about or what it is "awaiting", unless
you actually know that from your own conversation context, in which case say
so as your own addition, not as something the query told you). Example line:
"msg id 1481 -> bela, sent ~40m ago (not yet closed)." A not-yet-closed
status is NOT proof no reply came -- a reply can arrive as a separate message
without the original ever being closed, so do not phrase this list as
"confirmed unanswered". If a thread here is also listed under Open Questions'
"dispatched, not yet closed", cross-reference it there rather than letting
the two drift into inconsistent descriptions of the same open item.

State "none" explicitly if the query returned nothing -- same reasoning as
Open Questions: an omitted section is indistinguishable from a section nobody
generated.}
```

### 3. Deliver

**File mode** (default): Write HANDOFF.md to the project root (or `output` path).

**Inter-agent mode** (`target=` specified): Send the full HANDOFF.md content as an inter-agent message:

```bash
curl -s -X POST http://localhost:$PORT/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d "{\"from\":\"$AGENT_ID\",\"to\":\"TARGET\",\"content\":\"[HANDOFF] purpose: ... \n\n$(cat HANDOFF.md)\"}"
```

### 4. Confirm

Report to the user/caller:
- Where the handoff was written (file path or inter-agent message ID)
- Summary: how many kanban cards, memories, log entries, open questions, and
  waiting threads were included
- The `purpose` line for quick reference

## Pitfalls

- Do NOT include secrets, tokens, or .env values in the handoff
- Do NOT include full file contents -- use paths and line numbers
- Keep it under 3000 words -- the receiving session needs room to work. This
  limit is unchanged by the Open Questions / Inter-agent Waiting Threads
  sections: they are lists of short facts (who/what/when), not narrative, so
  they should not meaningfully compete with the word budget the other
  sections need.
- If `target=` agent is not running (check tmux), warn and fall back to file mode
- The handoff is a snapshot -- it goes stale. Include the timestamp prominently
- Do NOT omit Open Questions or Inter-agent Waiting Threads because they are
  empty -- write "none" explicitly. An omitted section and an empty one look
  identical to the next session, but mean opposite things ("nobody checked"
  vs "checked, there were none") -- the whole point of naming them as their
  own baseline sections is so a resumed session never has to guess which.

## Relation to other persistence mechanisms

| Mechanism | Scope | Handoff uses it as |
|-----------|-------|--------------------|
| checkpoint | Session summary (SQLite) | Source: pulls recent checkpoint data |
| DREAM.md | Nightly consolidation | Not directly -- too high-level |
| hot memory | Active task state | Source: includes active hot memories |
| warm memory | Stable project context | Source: includes relevant warm context |
| kanban | Task tracking | Source: includes assigned/active cards |
| daily log | Chronological record | Source: includes today's log entries |
| inter-agent messages | Cross-agent delegation queue | Source: `waiting-outbound` query feeds Inter-agent Waiting Threads |

The handoff READS from these systems but does not REPLACE them. After a handoff, the receiving session should still check the live state of kanban/memory -- the handoff is a starting-context accelerator, not the source of truth.
