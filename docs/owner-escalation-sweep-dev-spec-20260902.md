# Dev spec: system alerts go to BÉLA first, Istvan only if unresolved

Date: 2026-09-02
Author: PROGI
Related: kanban cf12a93a. Istvan's standing rule, stated a second time
2026-09-02 (first time 2026-08-29 for the scheduler's pending-retry/
task-timeout alerts): "a rendszer sajat riasztasai elobb BELA-hoz menjenek,
csak utana Istvanhoz ha nem oldodik meg."
Status: built, tested, not yet deployed (see section 6).

## 1. The named case (stuck-input-watcher.ts) and the sweep

BÉLA flagged `stuck-input-watcher.ts`'s `checkLocalSession()` (~line 255): a
sub-agent's parked-input give-up alert went straight to Istvan's Telegram via
`sendAlert()`, skipping BÉLA. Fixed (section 3).

Per the card's own quality mandate ("nezd at van-e MEG TOBB hasonlo... ne
csak ezt az egyet javitsd"), I grepped every `sendAlert(`/`notifyChannel(`/
`notifyTelegram(` call site in `src/` (14 files, ~20 call sites) and read
each one's surrounding context to classify it, rather than assuming the
named case was the only one. Full classification in section 2.

## 2. Classification: 13 sites fixed, 8 deliberately left alone

**Category B (fixed, routed through the new two-stage mechanism):**

1. `stuck-input-watcher.ts` `checkLocalSession` -- the named case
2. `channel-monitor.ts` `maybeAlertStuckSubAgent` -- a SIBLING overdue-guard
   mechanism for sub-agent stuck input, independent of #1
3. `channel-monitor.ts` thinking-block API error (isMarveen-conditional)
4. `channel-monitor.ts` login-picker needed (isMarveen-conditional, 2 sites)
5. `channel-monitor.ts` first-run screen auto-advanced (isMarveen-conditional)
6. `channel-monitor.ts` model-consent dialog auto-answered (isMarveen-conditional)
7. `channel-monitor.ts` blocking-menu Escape recovery (isMarveen-conditional)
8. `channel-monitor.ts` channel-down while agent busy (sub-agent only)
9. `channel-monitor.ts` channel-down after max restarts (sub-agent only)
10. `agent-process.ts` `maybeAlertSharedConfigCollision` -- fleet OAuth token
    / plugin-slot collision, not agent-specific but still a system alert
11. `agent-process.ts` sub-agent parked-input escalation
    (`SUBAGENT_PARKED_ESCALATE_AFTER` block, distinct from #2 and #1 --
    THREE independent sub-agent-stuck-input alert paths existed)
12. `agent-worker.ts` `alertWorkerStuck` -- internal background-worker
    session (agent-gen/capability-summary/heartbeat/digest), not a named
    fleet sub-agent, but still an internal system alert

**Category A (deliberately unchanged -- BÉLA's own session/pipeline, where
BÉLA-first doesn't make sense):**

- `channel-monitor.ts`: every `MAIN_CHANNELS_SESSION`-specific site in the
  down/recovery cascade (session vanished, resume came up deaf, stuck-
  restart cap, keepalive stale, hard-restart escalation, recovery notice) --
  8 call sites, all about BÉLA's OWN channel/session breaking or recovering
- `agent-process.ts`: the `MAIN_CHANNELS_SESSION` parked-input escalation
  (MAINBOXPARK816) -- its own comment already explains why: "an alert queued
  to the main agent would strand BEHIND the very text it reports"
- `stuck-tool-call-watcher.ts` -- scoped to `MAIN_CHANNELS_SESSION` only
  (`checkSession('main', ...)`), no sub-agent case exists yet
- `inbox-nudge-watcher.ts` -- `getPendingMessages(MAIN_AGENT_ID)`, BÉLA's own
  inbox-drain stall
- `channel-coordinator.ts` `fatalExit` -- a separate standalone process
  handling BÉLA's own inbound Telegram backfill; a fatal crash of BÉLA's own
  inbound pipeline
- `heartbeat.ts` -- not an alert at all, this is BÉLA's own heartbeat turn's
  generated OUTPUT going to its destination, out of scope

Every Category-A classification is locked by a regression test in
`owner-escalation-wiring.test.ts` (section 4) asserting these specific sites
still call the direct path -- not just that the Category-B sites changed.

## 3. The shared mechanism: `src/web/owner-escalation.ts`

Per the card's instruction to reuse the existing two-stage mechanism rather
than reimplement it: `escalateToOwner()`'s pure decision core
(`decideOwnerEscalation`) calls `shouldSendAlert()` directly, imported from
`pending-retries.ts` -- the exact same "has this timestamp passed a
threshold, guarded by a one-shot stamp" logic the scheduler's own pending-
retry/task-timeout two-stage escalation already uses. The absolute
threshold differs on purpose: `DEFAULT_STAGE2_EXTRA_MS` = 5 minutes here, vs.
`pending-retries.ts`'s `OWNER_ESCALATION_EXTRA_MS` = 75 minutes -- these
watchers typically detect and give up within 1-5 minutes, so reusing the
scheduler's hour-scale constant would leave Istvan in the dark for over an
hour on a wedged sub-agent.

`escalateToOwner({key, belaText, ownerText, stage2ExtraMs?})` is a single,
generic, stateful entry point (keyed Map, not DB-persisted -- these watchers
are already in-memory, process-local state, matching their pre-existing
design). Contract: call it EVERY TIME your own detection logic decides
"alert-worthy right now", not just once -- the first call sends the BÉLA
notice and stamps `stage1At`; repeat calls are no-ops until `stage2ExtraMs`
has elapsed with the problem still present, then ONE direct owner alert
fires; after that, further calls for the same key are no-ops until
`clearOwnerEscalation(key)` resets it (called at each site's own existing
"problem resolved" cleanup point).

This is what let 12 very differently-shaped call sites (one-shot-per-spell
Sets, per-context cooldown timestamps, repeat-every-N-minutes throttles)
share ONE implementation instead of each hand-rolling its own two-stage
logic: each site's EXISTING "is this alert-worthy right now" gate is
untouched, only the final `sendAlert(text)` call became `escalateToOwner
({key, belaText, ownerText})`.

## 4. Notable per-site decisions

- **Two distinct keys for channel-monitor.ts's two channel-down alerts**
  (`channel-down-busy` vs `channel-down-max-restarts`): these are different
  severities that can fire in sequence for the same down-spell. Sharing one
  key would let the more severe give-up alert get silently swallowed by
  escalateToOwner's per-key idempotency if the earlier, less severe alert
  had already completed its own stage-1/stage-2 cycle on that key.
- **`agent-process.ts`'s shared-config-collision alert had a pre-existing
  comment claiming it couldn't go through an inter-agent relay** ("would
  itself need a healthy channel agent to deliver"). Verified this reasoning
  doesn't actually hold: `countSameProviderChannelContenders` explicitly
  excludes `MAIN_AGENT_ID` from the collision count (BÉLA is never one of
  the colliding sub-agents), and inter-agent delivery (message-router.ts's
  tmux-inject path) is independent of any channel plugin's health anyway.
  Overrode it, but flagged this explicitly in the code comment and here --
  if there was a different, still-valid reason this analysis missed, it
  should surface in review rather than be silently lost.
- **Repeat-alert cadence changes**: several sites (`maybeAlertStuckSubAgent`,
  `alertWorkerStuck`) previously re-alerted Istvan directly every N minutes/
  hours for as long as the problem persisted. With the two-stage gate,
  stage 2 fires ONCE per spell (matching `pending-retries.ts`'s own
  established precedent -- its owner alert is also one-shot, not a repeat
  reminder). `agent-worker.ts`'s `alertWorkerStuck` has no natural
  "recovered" signal to hook a `clearOwnerEscalation` reset into (unlike
  every other site this card touched), so this one specifically goes from
  "hourly Istvan reminders forever" to "one BÉLA notice, one Istvan notice,
  then silence until a dashboard restart clears in-memory state" --
  documented in its own code comment as an intentional tradeoff, not an
  oversight; flagged here for BÉLA/Istvan to revisit if hourly reminders
  for a known, unresolved worker-stuck condition turn out to matter.

## 5. Testing

- `src/__tests__/owner-escalation.test.ts` (12 tests): the shared
  mechanism's pure decision function and stateful wrapper -- stage-1-then-
  stage-2 timing, one-shot-per-key idempotency, independent keys, failed-
  stage-1 retry, `clearOwnerEscalation` resetting a key for a fresh spell.
- `src/__tests__/owner-escalation-wiring.test.ts` (15 tests, new): SRC-
  anchored regression locks for every site touched (Category B) AND every
  site deliberately left alone (Category A) -- so a future edit that
  accidentally routes BÉLA's own session through `escalateToOwner` (which
  would strand the notice behind the very problem it reports) fails this
  file too, not just "did we add the new mechanism".
- `src/__tests__/stuck-input-owner-alert-busy-gate.test.ts` (updated, 11
  tests): the named case's own wiring test, updated to anchor on
  `escalateToOwner` instead of the old direct `sendAlert`, plus a new
  assertion that `checkLocalSession` no longer calls `sendAlert` at all.
- Full existing suite re-run in an isolated git worktree (this repo's
  `npm test` refuses to run against the live checkout --
  `assert-not-live-install.ts` confirms this really is the live install):
  **4092/4095 passing, 1 skipped.** The 2 failures
  (`memory-performance.test.ts`'s Ollama-reachability tests, timeouts under
  full-suite load) are the SAME pre-existing flake independently confirmed
  unrelated to a different task's changes earlier this session (passes
  cleanly in isolation) -- not a regression from this work.
- `tsc --noEmit`: clean throughout.

## 6. Deployment note (lesson from kanban 80f29abb, same day)

`stuck-input-watcher.ts`, `channel-monitor.ts`, `agent-process.ts`, and
`agent-worker.ts` all run inside the dashboard backend process
(`node dist/index.js`), NOT inside any individual agent's own `claude` CLI
session. Per the same lesson learned earlier today on kanban 80f29abb: this
source change alone does not reach the currently-running backend process
until `dist/` is rebuilt AND that process restarts. I ran `npm run build`
and confirmed via grep that `dist/web/owner-escalation.js` and the updated
`dist/web/{channel-monitor,agent-process,agent-worker}.js` all reflect this
change -- but did NOT restart the live backend process myself (same
reasoning as before: that affects the whole fleet's message routing/
scheduler, not just my sandbox). BÉLA's/Istvan's call on when to restart.

## 7. Codex review round 2 (2026-09-02) -- a real structural gap in the
   mechanism itself, fixed by a design change, not a per-site patch

BÉLA independently confirmed two of Codex's findings against the actual code
before relaying them (one applied, one didn't -- see below). Both were real.

### 7.1 The core gap: stage 2 depended on the CALLER re-invoking escalateToOwner

The round-1 design evaluated "is stage 2 due" only inside `escalateToOwner`
itself -- meaning stage 2 could only ever fire if a caller happened to call
`escalateToOwner` AGAIN, later, for the same key. For a call site driven by
a genuine periodic sweep (stuck-input-watcher.ts's 15s loop, most of
channel-monitor.ts's 60s `check()`), that repeat call always happens, so
those sites were fine in practice -- BÉLA verified this directly for
stuck-input-watcher.ts. But several sites are **demand-driven**, not
periodic:

- `agent-worker.ts`'s `alertWorkerStuck()` -- only called when someone
  actually dispatches a worker task and it isn't ready. BÉLA confirmed:
  if nothing tries to use the worker again while it's stuck (overnight, or
  a rarely-used feature), stage 2 would NEVER fire, no matter how long the
  worker stayed wedged -- Istvan would never learn about it. **Confirmed
  broken.**
- `agent-process.ts`'s `maybeAlertSharedConfigCollision()` -- only called on
  a sub-agent spawn attempt. Same structural risk.
- `channel-monitor.ts`'s two channel-down alerts (`alert-busy`,
  `alert`/max-restarts) were ALSO wrapped in their own pre-existing one-shot
  gates (`agentBusyDeferAlerted`/the restart-budget reset) that only ever
  called `escalateToOwner` ONCE per spell, even though the surrounding
  60s sweep is periodic -- same gap, found during this re-audit, not
  originally flagged by Codex/BÉLA but the same root cause.

**Fix (not a per-site patch): `escalateToOwner` now schedules a real,
cancelable stage-2 timer (`setTimeout`) the moment stage 1 fires.** The
timer fires on its own via the Node event loop after `stage2ExtraMs`,
completely independent of whether the caller ever calls `escalateToOwner`
again. `clearOwnerEscalation(key)` cancels the pending timer when the
underlying problem resolves. This closes the gap for ALL 13 sites at once,
including the ones with their own one-shot outer gates -- I did NOT need to
go back and rewrite each site's dedup logic (`agentBusyDeferAlerted`,
`sharedConfigCollisionAlerted`, `ctx.lastStuckAlert`, etc. all stay exactly
as they were), because a single call is now sufficient for the FULL two-
stage sequence to complete on its own. A repeat call (where the caller's own
logic happens to allow it) is still useful -- it refreshes the text the
eventual stage-2 alert uses to the latest known details -- but is no longer
REQUIRED.

Verified end-to-end (not just the core module's own unit test) against the
exact site Codex named as broken: `alertWorkerStuck` is now exported and
driven directly in `agent-worker-stuck-escalation.test.ts` with fake timers
-- a SINGLE call sends the BÉLA notice immediately and the direct owner
alert `DEFAULT_STAGE2_EXTRA_MS` later, with the existing 1-hour dispatch-
attempt cooldown confirmed to still gate repeat *dispatch attempts* without
gating whether the *first* call's stage-2 timer fires.

### 7.2 Stage 2 stamped "sent" before delivery was confirmed

`notifyChannel()` swallows every send failure internally and never rejects
its promise (by design, for its OTHER callers -- a fire-and-forget notice
shouldn't need error handling at every call site). The round-1
`escalateToOwner` used `notifyChannel(text).catch(() => {})` for stage 2,
which meant `stage2At` got stamped unconditionally, even on a silent
delivery failure -- a broken Telegram config would mark the alert "sent"
and never retry, forever.

**Fix**: added `notifyChannelOrThrow()` to `src/notify.ts` (same chunking/
formatting/provider-agnostic behavior as `notifyChannel`, just without the
internal swallow) and `escalateToOwner`'s stage-2 timer callback now awaits
it directly, stamping `stage2At` ONLY on confirmed success.
`classifyTelegramSendError()` -- reused from `pending-retries.ts`, not
reimplemented -- distinguishes a transient failure (retry soon, 60s) from a
permanent one (bad token/chat id; back off harder, 30min, so a broken
config doesn't spam the log every minute, but still eventually retries
rather than giving up forever in case the config gets fixed mid-incident).

### 7.3 Process-local state, lost on a dashboard restart

Codex is right that `escalationState`/the pending timers are in-memory
only, and the backend WAS restarted twice today. Evaluated persisting to
disk/DB and decided against it for now -- documented explicitly in
`owner-escalation.ts`'s own header comment (not left as a silent gap):
these watchers detect and resolve on a 1-5 minute scale, and
`DEFAULT_STAGE2_EXTRA_MS` is 5 minutes, so the exposure window is small,
and a persisted version would need its own startup-recovery/replay logic --
real complexity disproportionate to a 5-minute window. The residual risk is
asymmetric by category, which the code comment spells out:
- Periodic-sweep sites self-heal within one sweep interval after a restart
  (the very next tick re-detects an ongoing problem and starts a fresh
  stage-1 cycle).
- Demand-driven sites (`alertWorkerStuck`, `maybeAlertSharedConfigCollision`)
  only recover if their own natural trigger recurs after the restart --
  flagged as a known follow-up (a dedicated low-frequency periodic re-check
  for just these two watchers would close it, but that's a real
  architecture addition to files this card didn't otherwise need to touch,
  not something to bolt on unilaterally in this pass).

### 7.4 Key-collision check

Audited all 12 distinct key-prefix literals across the 4 touched files
(`owner-escalation-wiring.test.ts`'s new "escalation key collision check"
describe block) -- confirmed pairwise distinct by construction, both as a
literal-string uniqueness check and by confirming each prefix is genuinely
present in the file it's claimed to be in. Did not restructure into a
formal `component:session:alert-kind` 3-part namespace (Codex's suggestion)
since the existing `type:session` (or bare-literal for the one global,
non-session alert) convention already achieves uniqueness with the current
set, and a bigger restructuring for a property already satisfied felt like
unneeded churn -- worth revisiting if the key count grows enough that manual
verification stops being practical.

### 7.5 Testing added this round

- `src/__tests__/owner-escalation.test.ts`: rewritten for the timer-based
  design using `vi.useFakeTimers()` -- includes the exact integration shape
  Codex asked for (t0 stuck -> t0+3m resolved/cleared -> no stage-2 ever;
  t0 stuck -> t0+5m still stuck -> stage-2 fires once, using the FRESHEST
  text from the last call before it fired), plus transient/permanent
  delivery-failure retry behavior and the "stage2At only stamps on
  confirmed success" guarantee. 17 tests (was 12).
- `src/__tests__/notify.test.ts` (new, 3 tests): `notifyChannelOrThrow`
  resolves on success, throws (does not swallow) on failure.
- `src/__tests__/agent-worker-stuck-escalation.test.ts` (new, 2 tests):
  real end-to-end integration test against the actual `alertWorkerStuck`
  function (now exported) for the specific site Codex confirmed broken.
- `src/__tests__/owner-escalation-wiring.test.ts`: +1 describe block, the
  key-collision check (16 tests total, was 15).
- Full suite re-run in an isolated worktree: **4124/4126 passing, 1
  skipped** (the same pre-existing Ollama-reachability flake, confirmed
  unrelated earlier this session). `tsc --noEmit` clean.

## 8. Codex review round 3 (2026-09-02) -- the same gap, one step earlier, plus a real hang risk in shared infra

BÉLA independently confirmed one of the two main findings by reading the
code directly before relaying it.

### 8.1 Stage-1 failure had the identical lost-escalation pattern round 2 just fixed for stage 2

If `createAgentMessage` (the stage-1 BÉLA notice) threw on a demand-driven
site's ONLY invocation, nothing retried -- the round-2 timer fix did
nothing for this, since it only covered stage 2. **Fixed by unifying stage
1 and stage 2 into one recurring, self-scheduling `_tick(key)`** rather
than two separately-shaped mechanisms: a failed stage-1 attempt now
reschedules itself on `STAGE1_RETRY_MS` (30s) automatically; after
`STAGE1_MAX_ATTEMPTS` (5, ~2.5 min) consecutive failures, the key gives up
on reaching BÉLA and falls back to a DIRECT owner alert instead --
explicitly prefixed (`🔴 [BÉLA nem volt elerheto ...]`) so it never reads
as "BÉLA was notified but didn't fix it" when BÉLA was never actually
reached. A subtle bug caught in my own review of this fix before it even
ran once: the first draft fell through from a successful stage-1 send
straight into an immediate stage-2 attempt in the same tick (missing
`return`), which would have fired stage 2 instantly instead of waiting for
`DEFAULT_STAGE2_EXTRA_MS` -- caught by the test suite (9 failures in the
first run), fixed, all green after.

### 8.2 `telegramHttpPost` had no timeout at all -- confirmed by BÉLA reading the code directly

`src/channel-provider.ts`'s `telegramHttpPost` used a raw `https.request`
with no `req.setTimeout`, no `AbortController`, nothing -- a stalled TCP
connection (accepted, never responding) would leave the promise pending
forever, since `req.on('error')` only fires on a genuine connection-level
error. This became load-bearing once `fireStage2`/`_tick` started AWAITing
a send directly: an unbounded hang would leave that key's retry state stuck
forever with nothing to notice. **Fixed** by adding
`req.setTimeout(TOOL_TIMEOUTS['telegram'], ...)` + `req.destroy(err)` on
fire -- matching the SAME 10s deadline `src/web/telegram.ts`'s
`sendTelegramMessage` already uses via `AbortSignal.timeout` (this was the
one inconsistent, timeout-less Telegram send path in the codebase, not a
deliberate design choice). Verified with a dedicated test that mocks
`node:https` directly to simulate a hang (a real hanging local server isn't
usable here without a bigger refactor -- the URL is hardcoded to
`api.telegram.org`) and confirms the timeout fires, destroys the request,
and the resulting error is correctly classified as transient by
`classifyTelegramSendError` (also added to `pending-retries.test.ts`
directly, against the exact new error message).

### 8.3 Smaller points addressed

- **(a)** Corrected the module's own header comment, which had drifted into
  implying `shouldSendAlert`/`decideOwnerEscalation` govern live stage-2
  timing by reuse. They don't, since the round-2 timer redesign: production
  code runs entirely on `setTimeout`-driven `_tick`; `decideOwnerEscalation`
  is kept only as an independently useful, independently tested pure
  predicate. Made this explicit rather than leaving the misleading framing.
- **(b)** `classifyTelegramSendError` already had solid existing coverage
  with realistic error strings (`pending-retries.test.ts`, pre-dating this
  card) -- added the one missing case, the exact new timeout message from
  8.2, confirming it classifies as transient (no "Telegram API NNN"
  substring, correctly falls through to the network-failure branch).
- **(c)** Reframed the restart-loses-in-flight-state tradeoff for demand-
  driven sites from "small window" to an explicit, asymmetric PRODUCT RISK
  in the module's own header comment (section repeated from round 2, wording
  corrected) -- periodic-sweep sites self-heal within one sweep interval,
  demand-driven sites depend entirely on their own natural trigger recurring
  after a restart, which per Codex's own example could be never for a
  rarely-used worker function. Flagged as a concrete follow-up (give those
  two specific watchers their own periodic re-check) rather than resolved.
- **(d)** Evaluated a TTL/prune for stale Map entries and decided against
  it, documented in the module header: every production key is
  `${prefix}:${session}` where `session` is drawn from a small, FIXED fleet
  roster (never user-controlled or per-request), so the Map's size is
  inherently bounded regardless of how long any single entry survives.

### 8.4 Testing added this round

- `owner-escalation.test.ts`: stage-1 auto-retry (no second
  `escalateToOwner` call needed), the `STAGE1_MAX_ATTEMPTS` BÉLA-unreachable
  fallback (with a check that the fallback text is clearly labeled, not
  claiming BÉLA was notified), and a retry-of-the-fallback test confirming
  it does NOT loop back into re-attempting `createAgentMessage`. 19 tests
  (was 17).
- `channel-provider-telegram-timeout.test.ts` (new, 3 tests): the
  `node:https`-mocked hang/timeout/success-path tests for 8.2.
- `pending-retries.test.ts`: +1 test, the new timeout error message
  classified as transient.
- Full suite re-run in an isolated worktree: **4131/4132 passing, 1
  skipped, zero failures** (the previously-flaky Ollama-reachability test
  happened to pass this run too, consistent with it being a genuine timing
  flake under full-suite load rather than anything real). `tsc --noEmit`
  clean throughout.
