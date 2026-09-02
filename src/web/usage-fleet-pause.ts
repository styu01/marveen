// Technical enforcement for the usage-monitor's 90%+ hard pause (kanban
// ff2ed32d, Codex review point #4 in
// docs/usage-tracking-full-operational-analysis-20260901.md): until this
// module existed, `store/.usage-fleet-pause` was written by usage-monitor
// but read by NOTHING -- a full grep of src/ and scripts/ turned up zero
// consumers. The "pause" was entirely a matter of PROGI/OKOSKA/IRIS
// voluntarily honoring an inter-agent notice at the moment it arrived, with
// no check if a new task showed up later. This module is that check.
//
// Consumed by message-router.ts: a task-delegation message (see
// TASK_DELEGATION_MARKER below) to a protected agent is held -- not
// delivered, not marked failed, just left pending like a busy-target retry
// -- for as long as readFleetPauseState() reports paused. It clears itself
// automatically the tick after usage-monitor rewrites/empties the file.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from '../config.js'
import { logger } from '../logger.js'

export const USAGE_FLEET_PAUSE_PATH = join(STORE_DIR, '.usage-fleet-pause')

export interface FleetPauseState {
  paused: boolean
  metric?: string
  percent?: number
  source?: string
  since?: number
}

const NOT_PAUSED: FleetPauseState = { paused: false }

/**
 * Reads and parses store/.usage-fleet-pause. Missing or empty -> not
 * paused (this is usage-monitor's own documented "cleared" state, written
 * by unlinking/emptying the file on unpause). Tolerates the OLD plain-text
 * format (the literal string "paused", pre-2026-09-02) as a bare pause with
 * no metric detail, same as usage-monitor's own prompt already does on the
 * read side. Any read/parse failure fails OPEN (treated as not-paused, with
 * a warning logged) rather than closed: this file is a supplementary,
 * defense-in-depth layer on top of usage-monitor's own Telegram alert to
 * Istvan, which fires independently of this module -- failing closed on a
 * corrupt/unexpected file would risk silently wedging ALL new-task delivery
 * to three agents fleet-wide with no visible cause, a worse failure mode
 * than occasionally missing one enforcement cycle until the next
 * usage-monitor run (30 min) rewrites the file cleanly.
 */
export function readFleetPauseState(path: string = USAGE_FLEET_PAUSE_PATH): FleetPauseState {
  if (!existsSync(path)) return NOT_PAUSED
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    logger.warn({ err }, 'usage-fleet-pause: read failed, treating as not-paused')
    return NOT_PAUSED
  }
  const trimmed = raw.trim()
  if (!trimmed) return NOT_PAUSED
  if (trimmed === 'paused') return { paused: true }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch (err) {
    logger.warn({ err }, 'usage-fleet-pause: unparseable content, treating as not-paused')
    return NOT_PAUSED
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return NOT_PAUSED
  const d = data as Record<string, unknown>
  if (d.paused !== true) return NOT_PAUSED
  return {
    paused: true,
    metric: typeof d.metric === 'string' ? d.metric : undefined,
    percent: typeof d.percent === 'number' ? d.percent : undefined,
    source: typeof d.source === 'string' ? d.source : undefined,
    since: typeof d.since === 'number' ? d.since : undefined,
  }
}

// The sub-agents usage-monitor's pause/unpause inter-agent messages target
// (docs/usage-tracking-full-operational-analysis-20260901.md section 1.2).
// BÉLA (MAIN_AGENT_ID, the orchestrator issuing the pause) and VIZSLA
// (on-demand browser-reader, not an independent heavy-work agent in the
// same sense) are deliberately excluded. Update alongside usage-monitor's
// SKILL.md prompt if the protected set ever changes -- there is no shared
// registry to derive this from today.
export const FLEET_PAUSE_PROTECTED_AGENTS: ReadonlySet<string> = new Set(['progi', 'okoska', 'iris'])

// The documented, already-established convention BÉLA's own CLAUDE.md uses
// for a real task delegation to PROGI/OKOSKA/IRIS ("Küldj inter-agent
// üzenetet teljes kontextussal ... content: 'FELADAT:\n\n...'"). Matching
// on this specific marker -- rather than holding EVERY message to a
// protected agent -- is deliberate, not a shortcut:
//   - The pause/unpause control messages themselves (usage-monitor's own
//     SKILL.md prompt text: "MEGOSZTOTT USAGE >=90% ..." / "Usage limit
//     feloldva ...") do NOT start with this marker, so they are never held.
//     Gating ALL traffic instead would create a chicken-and-egg deadlock:
//     the pause notice would be held by the very pause it's announcing, and
//     an unpause notice sent after usage drops could get stuck queued
//     behind an earlier still-held pause notice, arriving out of order.
//   - Replies, clarifying questions, and routine coordination between a
//     paused agent and everyone else stay deliverable -- the pause means
//     "don't START new work", not "go silent", per usage-monitor's own
//     prompt text ("amit eppen csinalsz, fejezd be, de utana varj").
// "Big work" vs "small work" within a genuine FELADAT: delegation is NOT
// distinguished here -- see docs/usage-tracking-full-operational-analysis-
// 20260901.md point #5: there is no reliable, content-based way to measure
// task size, and a fake proxy (message length, keyword scan) would create
// false technical confidence without being trustworthy. This module only
// implements the 90%+ HARD pause (a full stop on new task delegation); the
// 80-90% "avoid starting BIG work" zone stays a documented, conscious
// human/agent operational recommendation, not a technical gate -- see the
// dev-spec for this task.
const TASK_DELEGATION_MARKER = 'FELADAT:'

/**
 * Pure decision, no I/O: should this specific message be held rather than
 * delivered right now? Takes an already-read FleetPauseState so callers
 * control when the file is read (message-router reads it once per tick,
 * not once per message).
 */
export function shouldHoldForFleetPause(
  toAgent: string,
  content: string,
  pauseState: FleetPauseState,
): boolean {
  if (!pauseState.paused) return false
  if (!FLEET_PAUSE_PROTECTED_AGENTS.has(toAgent)) return false
  return content.trimStart().startsWith(TASK_DELEGATION_MARKER)
}
