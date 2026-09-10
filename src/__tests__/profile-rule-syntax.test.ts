import { describe, expect, it } from 'vitest'
import { loadProfileTemplate, resolveProfilePlaceholders } from '../web/profiles.js'
import { PROJECT_ROOT } from '../config.js'

// TMPLPERM908 (ported from upstream Szotasz/marveen 823907f41, 2026-09-09):
// the permission-rule shapes below were measured against Claude Code's
// engine by the upstream fork on 2026-09-08 (strict launch, -p probes):
//   - Read(/abs/path/**)  -> single leading '/' is project-relative, NEVER matches
//   - Read(//abs/path/**) -> matches (allow and deny)
//   - Read(~/path/**)     -> matches (allow and deny)
//   - Bash(/abs/**/x.sh:*) -> '**' has no glob meaning in Bash rules; only a
//                             literal command prefix matches
// We could not re-run a live nested `claude -p` probe from this sandbox (the
// isolated agent config has no login session for a nested invocation), so
// this port relies on: (a) upstream's own measurement, (b) tracing our
// resolveProfilePlaceholders call site into writeAgentSettingsFromProfile,
// which writes the resolved strings verbatim into the SAME native
// permissions.allow/deny engine upstream measured, and (c) our own
// developer-junior/marketer/researcher strict profiles reproducing the exact
// ${HOME}/.ssh/.aws/.gnupg single-slash deny shape upstream found inert.
// These tests pin the normalization so a future edit cannot silently
// regress to the never-matching shapes.

const ctx = { HOME: '/home/testuser', AGENT_DIR: '/home/testuser/marveen/agents/tester' }

describe('resolveProfilePlaceholders rule normalization', () => {
  it('rewrites a single-slash absolute Read rule to the // absolute form', () => {
    expect(resolveProfilePlaceholders('Read(${HOME}/.ssh/**)', ctx))
      .toBe('Read(//home/testuser/.ssh/**)')
  })

  it('rewrites Edit and Write rules the same way', () => {
    expect(resolveProfilePlaceholders('Edit(${AGENT_DIR}/**)', ctx))
      .toBe('Edit(//home/testuser/marveen/agents/tester/**)')
    expect(resolveProfilePlaceholders('Write(/tmp/**)', ctx)).toBe('Write(//tmp/**)')
  })

  it('leaves already-absolute (//), home (~) and relative (**) rules untouched', () => {
    expect(resolveProfilePlaceholders('Read(//tmp/**)', ctx)).toBe('Read(//tmp/**)')
    expect(resolveProfilePlaceholders('Read(~/.claude/skills/**)', ctx)).toBe('Read(~/.claude/skills/**)')
    expect(resolveProfilePlaceholders('Read(**/.env)', ctx)).toBe('Read(**/.env)')
  })

  it('never touches Bash rules (command-prefix matching, not paths)', () => {
    expect(resolveProfilePlaceholders('Bash(sudo:*)', ctx)).toBe('Bash(sudo:*)')
    expect(resolveProfilePlaceholders('Bash(${PROJECT_ROOT}/scripts/notify.sh:*)', ctx))
      .toBe(`Bash(${PROJECT_ROOT}/scripts/notify.sh:*)`)
  })

  it('resolves ${PROJECT_ROOT}', () => {
    expect(resolveProfilePlaceholders('${PROJECT_ROOT}/scripts/x.sh', ctx))
      .toBe(`${PROJECT_ROOT}/scripts/x.sh`)
  })
})

describe('strict profile deny lists stay enforceable (TMPLPERM908)', () => {
  // developer-junior, marketer and researcher are the profiles that carry a
  // ${HOME}-based deny list (SSH/AWS/GnuPG/.env). Each one must resolve to
  // the '//' absolute form after resolveProfilePlaceholders, or the deny is
  // the silently-inert single-slash shape upstream measured as a security
  // hole (deny rules that never match anything).
  for (const id of ['developer-junior', 'marketer', 'researcher']) {
    it(`${id}'s ${'${HOME}'}-relative deny entries resolve to the absolute // form`, () => {
      const p = loadProfileTemplate(id)
      expect(p.id).toBe(id) // guard against the default-profile fallback
      const homeRelativeDenies = p.filesystem.deny.filter(
        (rule) => rule.includes('${HOME}') && /^(Read|Edit|Write)\(/.test(rule),
      )
      expect(homeRelativeDenies.length).toBeGreaterThan(0)
      for (const rule of homeRelativeDenies) {
        const resolved = resolveProfilePlaceholders(rule, ctx)
        expect(resolved).toMatch(/^(Read|Edit|Write)\(\/\//)
      }
    })
  }

  it('no template carries a dead Write() allow entry that duplicates a working Edit() allow for the same tree', () => {
    // Write() rules never matched the live engine's file-write permission
    // check (only Edit does); marketer/researcher used to carry a dead
    // Write(${AGENT_DIR}/**) alongside a working Edit(${AGENT_DIR}/**).
    for (const id of ['marketer', 'researcher']) {
      const p = loadProfileTemplate(id)
      expect(p.filesystem.allow).not.toContain('Write(${AGENT_DIR}/**)')
    }
  })

  it('no template carries a Bash rule with a ** glob (prefix matching cannot glob)', () => {
    for (const id of ['marketer', 'researcher', 'developer-junior', 'developer-senior', 'applier', 'sub-dev', 'default']) {
      const p = loadProfileTemplate(id)
      for (const rule of [...p.filesystem.allow, ...p.filesystem.deny]) {
        if (rule.startsWith('Bash(')) expect(rule).not.toContain('**')
      }
    }
  })
})
