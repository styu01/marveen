import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PROJECT_ROOT } from '../config.js'
import { latestTranscriptPathForProjectDir } from './active-model.js'

// Cold-tier filesystem archive for the proactive context-restart gate.
//
// This is intentionally NOT a daily-continuity channel. The normal continuity
// path remains the SessionStart ledger/task-state replay plus the agent's warm
// handoff note. These files are an emergency/research archive only: use grep
// or retrieve one concrete excerpt when investigating; NEVER load an entire
// exported transcript into an agent context.
export const CONTEXT_RESTART_ARCHIVE_DIR = join(
  PROJECT_ROOT, 'store', 'memory', 'cold', 'context-restart-transcripts',
)

function safeAgentPart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, '')
  if (!safe) throw new Error('agent name has no safe filename characters')
  return safe
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
      ? (part as Record<string, unknown>).text as string
      : '')
    .filter(Boolean)
    .join(' ')
}

/**
 * A filename-only hint from the last user message. Transcript content is
 * untrusted data: this function never interprets or executes it, and emits a
 * conservative ASCII slug only. Returning null is normal when no safe hint is
 * available.
 */
export function deriveTranscriptTopicHint(jsonl: string): string | null {
  const lines = jsonl.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]) as { message?: { role?: unknown; content?: unknown } }
      if (entry.message?.role !== 'user') continue
      const text = contentText(entry.message.content)
      const words = text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9]{3,}/g)
        ?.slice(0, 5) ?? []
      const hint = words.join('-').slice(0, 48)
      return hint || null
    } catch { /* malformed JSONL line: keep looking */ }
  }
  return null
}

/**
 * Format ALL JSONL records as indented text, retaining even malformed lines.
 * This is deliberately complete rather than a lossy "summary": the archive
 * is for selective forensic search, not automatic context replay.
 */
export function formatFullTranscriptForArchive(jsonl: string, sourcePath: string): string {
  const out = [
    'CONTEXT-RESTART TRANSCRIPT ARCHIVE',
    `Source JSONL: ${sourcePath}`,
    'Purpose: research/emergency archive only; not a daily-continuity input.',
    'Use selective grep or a concrete excerpt. NEVER load this entire file into an agent context.',
    '',
  ]
  let index = 0
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue
    index++
    out.push(`===== RECORD ${index} =====`)
    try {
      out.push(JSON.stringify(JSON.parse(raw), null, 2))
    } catch {
      // Preserve the raw record too: an interrupted Claude JSONL append must
      // not turn "full transcript" into a silently truncated archive.
      out.push('[MALFORMED JSONL RECORD - preserved verbatim]')
      out.push(raw)
    }
    out.push('')
  }
  if (index === 0) throw new Error('transcript is empty')
  return out.join('\n')
}

export interface ContextRestartArchiveResult {
  path: string
  sourcePath: string
}

/**
 * Export the newest transcript BEFORE an actual gate /clear. Failure throws;
 * the caller must then refrain from sending /clear so no clear can occur
 * without its required cold-tier archive.
 */
export function archiveTranscriptBeforeContextRestart(opts: {
  agent: string
  workingDir: string
  configDir?: string
  nowMs: number
}): ContextRestartArchiveResult {
  const sourcePath = latestTranscriptPathForProjectDir(opts.workingDir, opts.configDir)
  if (!sourcePath) throw new Error('no readable session transcript to archive')
  const raw = readFileSync(sourcePath, 'utf-8')
  const agent = safeAgentPart(opts.agent)
  const iso = new Date(opts.nowMs).toISOString()
  const topic = deriveTranscriptTopicHint(raw)
  const filename = `${agent}_${iso}${topic ? `_${topic}` : ''}.txt`
  const destination = join(CONTEXT_RESTART_ARCHIVE_DIR, filename)
  mkdirSync(CONTEXT_RESTART_ARCHIVE_DIR, { recursive: true })
  const tmp = join(CONTEXT_RESTART_ARCHIVE_DIR, `.${basename(filename)}.${process.pid}.tmp`)
  writeFileSync(tmp, formatFullTranscriptForArchive(raw, sourcePath), 'utf-8')
  renameSync(tmp, destination)
  return { path: destination, sourcePath }
}
