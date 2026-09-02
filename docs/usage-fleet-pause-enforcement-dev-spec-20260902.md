# Dev spec: usage-fleet-pause technical enforcement + "big work" definition

Date: 2026-09-02
Author: PROGI
Related: kanban ff2ed32d, Codex review points #4 and #5 in
`docs/usage-tracking-full-operational-analysis-20260901.md`
Status: built, tested, ready for review. Not yet deployed to any live agent
process (touches shared code that only takes effect on the running
dashboard backend's next restart -- see section 5).

## 1. Scope

This card covers exactly two of the analysis doc's findings, per BÉLA's
explicit framing -- Codex's #6 (paused state vs source-drop-to-estimate) and
#8 (dedup state for repeat 90%+ crossings) are NOT in scope here:

- **#4**: `store/.usage-fleet-pause` is written by the `usage-monitor`
  scheduled task at a 90%+ crossing, but nothing reads it back. The "pause"
  was entirely voluntary compliance at the moment an inter-agent notice
  arrived, with no check if a new task showed up later.
- **#5**: the 80-90% "don't start big work" rule has no machine definition
  of "big" and no enforcement -- purely a prompt-level recommendation.

## 2. #4: technical enforcement

### 2.1 Where it lives

`src/web/usage-fleet-pause.ts` (new, pure/testable) + a small integration
point in `src/web/message-router.ts` (the component that already injects
every inter-agent message into a target session's tmux pane, and already
implements the exact "hold until ready, retry next tick" pattern this needed
-- see `isSessionReadyForPrompt`/busy-pane handling in the same file).

### 2.2 What gets held, and why not everything

A message is held (left pending, retried every 5s tick, same as a busy
target) when ALL of:
1. `readFleetPauseState()` reports `paused: true`.
2. `msg.to_agent` is one of `progi`/`okoska`/`iris` (`FLEET_PAUSE_PROTECTED_
   AGENTS` -- the exact three names the analysis doc's section 1.2 names as
   usage-monitor's pause/unpause targets; BÉLA and vizsla excluded).
3. `msg.content`, after trimming leading whitespace, starts with `FELADAT:`
   -- the exact, already-established convention BÉLA's own CLAUDE.md uses
   for a real task delegation to these three agents.

Point 3 is the one worth justifying carefully, since "hold everything to a
paused agent" was the more obvious first design and turned out to be wrong:

- The pause/unpause control messages usage-monitor itself sends do NOT
  start with `FELADAT:` (verified against the actual current prompt text in
  `~/.claude/scheduled-tasks/usage-monitor/SKILL.md`: `"MEGOSZTOTT USAGE
  >=90% ..."` / `"Usage limit feloldva ..."`). Gating all traffic would
  create a chicken-and-egg deadlock: the pause announcement would be held
  by the very pause it's announcing (the target would never learn it's
  paused), and an unpause notice sent later could get stuck queued behind
  an earlier still-held pause notice -- arriving out of order, confusingly,
  after usage had already dropped back down.
- The pause itself only means "don't START new work" -- usage-monitor's own
  prompt text says so explicitly ("amit eppen csinalsz, fejezd be, de utana
  varj" -- finish what you're doing, then wait). Replies, clarifying
  questions, and routine coordination between a paused agent and everyone
  else are legitimate and should keep flowing; blocking them would be
  broader than the actual policy.

There is no reliable way to distinguish "genuinely new task" from "reply
about an existing one" from message content alone in general -- `FELADAT:`
is not a perfect proxy, but it's the one convention that's already
consistently used fleet-wide for exactly the case this needs to catch
(BÉLA/whoever delegating a new task), verified against the real CLAUDE.md
text rather than assumed.

### 2.3 Fail-open on a corrupt/unexpected pause file

`readFleetPauseState()`: missing or empty file -> not paused (usage-
monitor's own documented "cleared" convention). The old plain-text `paused`
format (pre-2026-09-02, before BÉLA switched the prompt to JSON) is still
recognized as a bare pause, matching how usage-monitor's own prompt already
tolerates it on the read side. Any read error or unparseable/unexpected
JSON content fails OPEN -- treated as not-paused, with a warning logged --
rather than closed. This is a deliberate choice: this file is a
supplementary, defense-in-depth layer on top of usage-monitor's own direct
Telegram alert to Istvan, which fires independently of this module and
doesn't depend on it. Failing closed on a corrupt file would risk silently
wedging ALL new-task delivery to three agents fleet-wide with no visible
cause -- a worse failure mode than occasionally missing one enforcement
cycle until usage-monitor's next run (30 min) rewrites the file cleanly.

### 2.4 Notification back to the orchestrator

Per the kanban card's own framing ("jelezze vissza hogy usage-pause miatt
varakozik"): the first time a given message id gets held, one `system ->
BÉLA` inter-agent notice is created (`notifyOrchestratorOfHeldForUsagePause`,
mirroring the file's existing `notifyOrchestratorOfFailedHandoff`/
`notifyOrchestratorOfStuckSession` pattern exactly). Goes to BÉLA
(`MAIN_AGENT_ID`) rather than literally `msg.from_agent`, because BÉLA is
who actually issues these delegations in the documented flow and also who
owns unpausing -- consistent with every other router notice in this file.
Fired once per message id via a new `routerUsagePauseNotified: Set<number>`,
cleared on every terminal outcome for that id (delivered/abandoned/failed)
so it can never grow unbounded, same lifecycle as the pre-existing
`routerLoggedMisses`/`routerInjectFailures`.

### 2.5 What happens automatically once usage-monitor clears the file

Nothing extra needed: the held message just stays pending in the normal
queue, and the NEXT 5s router tick re-evaluates `shouldHoldForFleetPause`
against a freshly-read pause state. Once usage-monitor empties/rewrites
`store/.usage-fleet-pause` on the unpause branch, the very next tick
delivers the held message normally. No separate "wake the held queue" logic
was needed.

## 3. #5: no machine definition of "big work" -- staying a documented
   operational recommendation, not a technical gate

Evaluated and deliberately NOT building a proxy. Task "size" is semantic --
message length, keyword scanning, or any other syntactic heuristic would
give FALSE technical confidence without being trustworthy (a one-line
`FELADAT:` message can request an enormous refactor; a long one can be a
detailed spec for something trivial). Building an unreliable gate and
calling it "enforcement" would be worse than being honest about the limit,
and would directly contradict Istvan's explicit instruction not to conflate
a real technical gate with an operational recommendation.

The current `usage-monitor` prompt (`~/.claude/scheduled-tasks/usage-monitor
/SKILL.md`, already updated by BÉLA before this card was created) already
states this correctly and doesn't need a change from this task: *"Ha 80-90
kozott (egyik sincs 90 felett): NE inditsal uj NAGY feladatot Priginek/
OKOSKA-nak, hagyd befejezni amit csinal, de meg nem kell megallni.
(Megjegyzes: ez ma viselkedesi ajanlas, nincs technikai kikenyszeritve --
kulon kodszintu munka fut ra, ne ess kesztetesbe hogy magad probald
'kikenyszeriteni' mashogy.)"* -- verified this text is present, current, and
already explicitly flags itself as non-technical, exactly the "don't
conflate the two" outcome the kanban card asked for. The 80-90% zone
doesn't write any state file at all (only the 90%+ crossing writes
`store/.usage-fleet-pause`), so section 2's enforcement mechanism correctly
has nothing to act on in that zone -- confirmed consistent by construction,
not by accident.

## 4. Testing

- `src/__tests__/usage-fleet-pause.test.ts` (20 tests): `readFleetPauseState`
  against missing/empty/whitespace/valid-JSON/old-plain-text/malformed-JSON/
  wrong-type-detail-fields cases; `shouldHoldForFleetPause` against
  paused/not-paused, FELADAT/non-FELADAT, protected/unprotected agent,
  leading-whitespace, and substring-vs-exact-marker cases.
- `src/__tests__/message-router-usage-pause.test.ts` (7 tests, full
  `runMessageRouterTick()` integration with the same mocking pattern as the
  pre-existing `message-router-tick-cap.test.ts`): holds a FELADAT:
  delegation while paused (not delivered, not failed); notifies BÉLA once;
  delivers normally when not paused; delivers non-FELADAT: messages even
  while paused; delivers the pause/unpause control messages themselves even
  while paused (the chicken-and-egg case, explicitly proven not to
  deadlock); delivers to an unprotected agent even while paused; holds
  multiple protected agents independently in the same tick.
- `tsc --noEmit`: clean.
- Full suite re-run in an isolated git worktree (this repo's `npm test`
  refuses to run against the live checkout -- `assert-not-live-install.ts`
  detects `store/.dashboard-token` etc. and aborts, confirming this really
  is the live install): **4085/4087 passing, 1 skipped.** The single
  failure (`memory-performance.test.ts`'s Ollama-reachability test, a 5s
  timeout under full-suite load) was confirmed pre-existing and unrelated
  by re-running it alone on a second, completely clean worktree with none
  of this task's changes applied -- passes in 1.8s there. Not a regression
  from this work.

## 5. Deployment note

`message-router.ts` runs inside the dashboard backend process
(`startMessageRouter()`, called from `src/web.ts`), which is a separate,
already-running Node process independent of any individual agent's `claude`
CLI session (confirmed in the analysis doc's point #7). This code change
only takes effect the next time that backend process restarts -- it does
not affect the currently-running router, and does not touch any agent's own
session. No agent needs to be restarted for this to eventually take effect;
whoever manages the dashboard backend's own deploy/restart cycle handles
that separately, same as any other backend code change.

## 6. What's NOT done / explicitly out of scope

- Codex's #6 (paused state should survive a mid-pause drop to `estimate`
  source) and #8 (dedup state for repeat 90%+ crossings) -- not in this
  card. Worth noting: #6 already appears to hold correctly by construction
  -- usage-monitor's "unreliable source" branch (section "1. AG" in the
  SKILL.md) never touches `store/.usage-fleet-pause`, only the reliable-
  source branch does, so a mid-pause drop to `estimate` leaves the pause
  file untouched (still paused) rather than silently clearing it. Verified
  by reading the current prompt text, not assumed -- but this observation
  is incidental to this card's scope, not a claim that #6 is closed as a
  kanban item.
- No change to `usage-monitor`'s own prompt text was needed for either #4
  or #5 -- #4's enforcement is a pure code-side addition the prompt doesn't
  need to know about (the file it already writes is simply read now), and
  #5's prompt text was already correct going in.
