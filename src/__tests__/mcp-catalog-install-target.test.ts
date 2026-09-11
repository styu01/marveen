import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { PROJECT_ROOT, MAIN_AGENT_ID } from '../config.js'
import { AGENTS_BASE_DIR } from '../web/agent-config.js'
import { getBindings, addBinding, removeBinding, syncSecret } from '../web/vault-bindings.js'
import { getSecret, listSecrets, deleteSecret } from '../web/vault.js'
import {
  targetMcpPath,
  buildCatalogServerConfig,
  installCatalogItem,
  uninstallCatalogItem,
  resolveCatalogTargets,
} from '../web/routes/connectors.js'

// Kanban 24152d84 (2026-09-11): the Dashboard MCP-catalog "Telepítés" button
// used to run `claude mcp add` from the dashboard SERVER's own process env,
// which has no CLAUDE_CONFIG_DIR -- every install silently landed in the
// operator's shared ~/.claude.json, never in any agent's actual config
// (live-reproduced and immediately reverted, see kanban comment history).
// This fix drops the CLI entirely in favor of a direct, per-target
// .mcp.json write. These tests exercise that write against REAL filesystem
// paths, but ONLY throwaway sub-agent directories under AGENTS_BASE_DIR --
// NEVER PROJECT_ROOT/.mcp.json itself, since that file is the actual, live
// MCP config for whichever checkout this suite happens to run in (including
// this worktree's own). The only place MAIN_AGENT_ID appears below is I/O-free:
// the pure path-resolution assertion in `targetMcpPath`, and the
// `resolveCatalogTargets` validation tests (agent-id/remote-host checks only).

// Codex review (2026-09-11, 2nd round): a FIXED test-agent directory name,
// unconditionally rmSync'd at suite start, is itself a small destructive-test
// risk -- if a directory of that exact name ever legitimately existed (stale
// leftover from a differently-shaped past run, or a genuine collision), this
// suite would silently delete it. A per-run random suffix makes collision
// astronomically unlikely, and `createFreshTestAgentDir` below fails LOUDLY
// instead of deleting anything it didn't itself create.
const RUN = randomUUID().slice(0, 8)
const TEST_AGENT = `mcp-install-test-agent-${RUN}`
const TEST_AGENT_2 = `mcp-install-test-agent-2-${RUN}`
const TEST_REMOTE_AGENT = `mcp-install-test-remote-agent-${RUN}`
const TEST_AGENT_DIR = join(AGENTS_BASE_DIR, TEST_AGENT)
const TEST_AGENT_2_DIR = join(AGENTS_BASE_DIR, TEST_AGENT_2)
const TEST_REMOTE_AGENT_DIR = join(AGENTS_BASE_DIR, TEST_REMOTE_AGENT)
const TEST_AGENT_MCP_PATH = join(TEST_AGENT_DIR, '.mcp.json')
const TEST_AGENT_2_MCP_PATH = join(TEST_AGENT_2_DIR, '.mcp.json')

function createFreshTestAgentDir(dir: string, config: unknown): void {
  if (existsSync(dir)) {
    throw new Error(
      `Test agent directory unexpectedly already exists: ${dir} -- refusing to delete/overwrite an ` +
      `unknown existing directory. If this is genuine stale leftover from a crashed prior run, remove it ` +
      `manually and re-run.`,
    )
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-config.json'), JSON.stringify(config))
}

function cleanupTestAgentMcpJsons() {
  try { rmSync(TEST_AGENT_MCP_PATH) } catch { /* did not exist */ }
  try { rmSync(TEST_AGENT_2_MCP_PATH) } catch { /* did not exist */ }
}

beforeAll(() => {
  createFreshTestAgentDir(TEST_AGENT_DIR, {})
  createFreshTestAgentDir(TEST_AGENT_2_DIR, {})
  createFreshTestAgentDir(TEST_REMOTE_AGENT_DIR, { remoteHost: 'test.example.com', remoteWorkdir: '/home/test/marveen' })
})

afterAll(() => {
  // Safe to unconditionally rmSync here -- these are directories THIS suite
  // itself just created above (createFreshTestAgentDir already refused to
  // touch anything pre-existing), not an unknown/inherited path.
  cleanupTestAgentMcpJsons()
  rmSync(TEST_AGENT_DIR, { recursive: true, force: true })
  rmSync(TEST_AGENT_2_DIR, { recursive: true, force: true })
  rmSync(TEST_REMOTE_AGENT_DIR, { recursive: true, force: true })
})

// Codex review (2026-09-11, 3rd round): the Vault-binding tests below create
// REAL entries in this worktree's own (isolated, see the top-of-file
// comment) store/vault.json + store/vault-bindings.json, but nothing was
// ever cleaning them up -- repeated suite runs would accumulate stale test
// secrets/bindings there indefinitely. Every vaultId these tests create is
// derived from freshId(), which embeds RUN, so sweeping by that prefix after
// EVERY test (not just at the end of the suite) catches entries left behind
// even by a test that fails/throws partway through.
afterEach(() => {
  const prefix = `mcp-install-test-${RUN}-`
  for (const b of getBindings()) {
    if (b.vaultSecretId.startsWith(prefix)) removeBinding(b.vaultSecretId, b.envVar)
  }
  for (const s of listSecrets()) {
    if (s.id.startsWith(prefix)) deleteSecret(s.id)
  }
})

// Every test uses its OWN unique catalog item id, so tests sharing the same
// underlying TEST_AGENT_MCP_PATH file don't need to clean up between each other.
let idCounter = 0
const freshId = () => `mcp-install-test-${RUN}-${++idCounter}`

describe('targetMcpPath', () => {
  it('resolves the main agent to PROJECT_ROOT/.mcp.json', () => {
    expect(targetMcpPath(MAIN_AGENT_ID)).toBe(join(PROJECT_ROOT, '.mcp.json'))
  })

  it('resolves a sub-agent to agents/<name>/.mcp.json', () => {
    expect(targetMcpPath(TEST_AGENT)).toBe(join(AGENTS_BASE_DIR, TEST_AGENT, '.mcp.json'))
  })
})

describe('buildCatalogServerConfig', () => {
  it('builds a local (stdio) config, splitting user secrets from non-secret defaults', () => {
    const { config, secrets } = buildCatalogServerConfig(
      { type: 'local', command: 'npx', args: ['-y', 'some-mcp'], env: { NON_SECRET: 'value', API_KEY: '' } },
      { API_KEY: 'sekrit-123' },
    )
    expect(config).toEqual({ command: 'npx', args: ['-y', 'some-mcp'], env: { NON_SECRET: 'value' } })
    expect(secrets).toEqual({ API_KEY: 'sekrit-123' })
  })

  it('omits the env key entirely when there are no non-secret defaults', () => {
    const { config } = buildCatalogServerConfig({ type: 'local', command: 'echo', args: [] }, {})
    expect(config).toEqual({ command: 'echo', args: [] })
    expect((config as any).env).toBeUndefined()
  })

  it('throws for a local item with no command', () => {
    expect(() => buildCatalogServerConfig({ type: 'local' }, {})).toThrow(/command/i)
  })

  it('builds a remote config with default sse transport', () => {
    const { config, secrets } = buildCatalogServerConfig({ type: 'remote', url: 'https://example.com/mcp' }, {})
    expect(config).toEqual({ url: 'https://example.com/mcp', transport: 'sse' })
    expect(secrets).toEqual({})
  })

  it('respects an explicit http transport for remote', () => {
    const { config } = buildCatalogServerConfig({ type: 'remote', url: 'https://example.com/mcp', transport: 'http' }, {})
    expect(config).toEqual({ url: 'https://example.com/mcp', transport: 'http' })
  })

  it('throws for a remote item with an invalid/missing URL', () => {
    expect(() => buildCatalogServerConfig({ type: 'remote', url: 'not-a-url' }, {})).toThrow(/URL/i)
    expect(() => buildCatalogServerConfig({ type: 'remote' }, {})).toThrow(/URL/i)
  })

  it('throws for an unsupported item type', () => {
    expect(() => buildCatalogServerConfig({ type: 'bogus' }, {})).toThrow(/Unsupported/i)
  })
})

describe('resolveCatalogTargets', () => {
  it('requires a non-empty array -- no implicit default target', () => {
    expect(resolveCatalogTargets(undefined).error).toMatch(/required/i)
    expect(resolveCatalogTargets([]).error).toMatch(/required/i)
    expect(resolveCatalogTargets('bela').error).toMatch(/required/i) // not an array
  })

  it('accepts the main agent and a known local sub-agent', () => {
    const { targets, error } = resolveCatalogTargets([MAIN_AGENT_ID, TEST_AGENT])
    expect(error).toBeUndefined()
    expect(targets).toEqual([MAIN_AGENT_ID, TEST_AGENT])
  })

  it('rejects an unknown agent id', () => {
    const { error } = resolveCatalogTargets(['definitely-not-a-real-agent-zzz'])
    expect(error).toMatch(/Unknown agent/)
  })

  it('rejects a remote-configured agent', () => {
    const { error } = resolveCatalogTargets([TEST_REMOTE_AGENT])
    expect(error).toMatch(/remote host/i)
  })

  it('de-duplicates repeated target ids', () => {
    const { targets } = resolveCatalogTargets([MAIN_AGENT_ID, MAIN_AGENT_ID, TEST_AGENT])
    expect(targets).toEqual([MAIN_AGENT_ID, TEST_AGENT])
  })
})

describe('installCatalogItem / uninstallCatalogItem (real filesystem, throwaway test-agent paths only)', () => {
  it('installs a local server into the primary test agent .mcp.json, does not touch other targets on their own file', () => {
    const id = freshId()
    const results = installCatalogItem(
      { id, type: 'local', command: 'npx', args: ['-y', id] },
      [TEST_AGENT],
      {},
    )
    expect(results).toEqual([{ agent: TEST_AGENT, ok: true }])
    const written = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    expect(written.mcpServers[id]).toEqual({ command: 'npx', args: ['-y', id] })
    expect(existsSync(TEST_AGENT_2_MCP_PATH)).toBe(false) // sub-agent untouched
  })

  it('installs into MULTIPLE targets independently -- the actual bug this fixes (the old CLI path could only ever hit one shared, wrong location)', () => {
    const id = freshId()
    const results = installCatalogItem(
      { id, type: 'remote', url: 'https://example.com/mcp' },
      [TEST_AGENT, TEST_AGENT_2],
      {},
    )
    expect(results.every(r => r.ok)).toBe(true)
    const firstWritten = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    const secondWritten = JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8'))
    expect(firstWritten.mcpServers[id]).toEqual({ url: 'https://example.com/mcp', transport: 'sse' })
    expect(secondWritten.mcpServers[id]).toEqual({ url: 'https://example.com/mcp', transport: 'sse' })
  })

  it('preserves an existing, unrelated server entry already in the target .mcp.json (merge, not overwrite)', () => {
    const preexisting = { command: 'echo', args: ['preexisting'] }
    writeFileSync(TEST_AGENT_MCP_PATH, JSON.stringify({ mcpServers: { 'already-here': preexisting } }))
    const id = freshId()
    installCatalogItem({ id, type: 'local', command: 'npx', args: [] }, [TEST_AGENT], {})
    const written = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    expect(written.mcpServers['already-here']).toEqual(preexisting)
    expect(written.mcpServers[id]).toBeDefined()
  })

  it('refuses to overwrite a target .mcp.json that is not valid JSON (fail-closed)', () => {
    writeFileSync(TEST_AGENT_MCP_PATH, '{ not valid json')
    const id = freshId()
    const results = installCatalogItem({ id, type: 'local', command: 'npx', args: [] }, [TEST_AGENT], {})
    expect(results[0].ok).toBe(false)
    expect(results[0].error).toMatch(/not valid JSON/i)
    // The corrupt file must be left exactly as it was, not partially overwritten.
    expect(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8')).toBe('{ not valid json')
  })

  it('one failing target does not prevent the others from succeeding', () => {
    writeFileSync(TEST_AGENT_MCP_PATH, '{ not valid json')
    const id = freshId()
    const results = installCatalogItem(
      { id, type: 'local', command: 'npx', args: [] },
      [TEST_AGENT, TEST_AGENT_2],
      {},
    )
    const first = results.find(r => r.agent === TEST_AGENT)!
    const second = results.find(r => r.agent === TEST_AGENT_2)!
    expect(first.ok).toBe(false)
    expect(second.ok).toBe(true)
    const secondWritten = JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8'))
    expect(secondWritten.mcpServers[id]).toBeDefined()
  })

  it('uninstalls from the targeted agent only, leaving other targets untouched', () => {
    cleanupTestAgentMcpJsons()
    const id = freshId()
    installCatalogItem({ id, type: 'local', command: 'npx', args: [] }, [TEST_AGENT, TEST_AGENT_2], {})
    const results = uninstallCatalogItem(id, [TEST_AGENT])
    expect(results).toEqual([{ agent: TEST_AGENT, ok: true }])
    const firstWritten = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    expect(firstWritten.mcpServers[id]).toBeUndefined()
    const secondWritten = JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8'))
    expect(secondWritten.mcpServers[id]).toBeDefined() // untouched
  })

  it('uninstalling a never-installed item / missing file is a no-op success, not an error', () => {
    cleanupTestAgentMcpJsons()
    const results = uninstallCatalogItem('never-installed-zzz', [TEST_AGENT])
    expect(results).toEqual([{ agent: TEST_AGENT, ok: true }])
  })

  it('hardens the target .mcp.json to 0600 on every install/uninstall write, even if it was previously more permissive', () => {
    // Codex review (2026-09-11, 2nd round): the first fix only PRESERVED
    // whatever mode a file already had -- this asserts the corrected
    // behavior, that every write actively tightens a looser mode to 0600
    // rather than perpetuating it (matching vault-bindings.ts's own
    // syncSecret/unsyncBinding, which always force 0600).
    cleanupTestAgentMcpJsons()
    const id = freshId()
    installCatalogItem({ id, type: 'local', command: 'npx', args: [] }, [TEST_AGENT], {})
    expect(statSync(TEST_AGENT_MCP_PATH).mode & 0o777).toBe(0o600)

    chmodSync(TEST_AGENT_MCP_PATH, 0o644)
    expect(statSync(TEST_AGENT_MCP_PATH).mode & 0o777).toBe(0o644)

    const id2 = freshId()
    installCatalogItem({ id: id2, type: 'local', command: 'npx', args: [] }, [TEST_AGENT], {})
    expect(statSync(TEST_AGENT_MCP_PATH).mode & 0o777).toBe(0o600)

    chmodSync(TEST_AGENT_MCP_PATH, 0o644)
    uninstallCatalogItem(id2, [TEST_AGENT])
    expect(statSync(TEST_AGENT_MCP_PATH).mode & 0o777).toBe(0o600)
  })
})

describe('installCatalogItem / uninstallCatalogItem -- Vault secret binding (real, isolated store/vault files under this worktree/checkout only)', () => {
  it('multi-target secret install: the Vault binding contains exactly both targets, and a fresh sync updates both configs', () => {
    // Regression test for the actual 24152d84 bug: a per-target loop calling
    // addBinding() would REPLACE the whole binding on each call (its key is
    // (vaultSecretId, envVar)), so installing to A then B left the binding
    // pointing ONLY at B -- A's vault ref was already written once, but the
    // NEXT secret rotation/sync would only ever touch B, silently orphaning A.
    const id = freshId()
    const results = installCatalogItem(
      { id, type: 'local', command: 'npx', args: [], env: { API_KEY: '' } },
      [TEST_AGENT, TEST_AGENT_2],
      { API_KEY: 'sekrit-multi-target' },
    )
    expect(results).toEqual([{ agent: TEST_AGENT, ok: true }, { agent: TEST_AGENT_2, ok: true }])

    const vaultId = `${id}-api_key`
    const binding = getBindings().find(b => b.vaultSecretId === vaultId && b.envVar === 'API_KEY')
    expect(binding).toBeDefined()
    expect(binding!.targets).toHaveLength(2)
    expect(binding!.targets).toEqual(expect.arrayContaining([
      { mcpFilePath: TEST_AGENT_MCP_PATH, serverName: id },
      { mcpFilePath: TEST_AGENT_2_MCP_PATH, serverName: id },
    ]))

    // Simulate a secret rotation: stomp both configs' env value, then re-sync
    // -- the fixed union-write binding must update BOTH files, not just
    // whichever target happened to be last written in a per-target loop.
    for (const p of [TEST_AGENT_MCP_PATH, TEST_AGENT_2_MCP_PATH]) {
      const cfg = JSON.parse(readFileSync(p, 'utf-8'))
      cfg.mcpServers[id].env.API_KEY = 'stale-value'
      writeFileSync(p, JSON.stringify(cfg))
    }
    const syncResult = syncSecret(vaultId)
    expect(syncResult.errors).toEqual([])
    expect(syncResult.updated).toBe(2)
    const firstAfter = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    const secondAfter = JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8'))
    expect(firstAfter.mcpServers[id].env.API_KEY).toBe(`vault:${vaultId}`)
    expect(secondAfter.mcpServers[id].env.API_KEY).toBe(`vault:${vaultId}`)
  })

  it('uninstalling one target removes only it from the Vault binding, and a subsequent sync no longer errors for the removed target', () => {
    const id = freshId()
    installCatalogItem(
      { id, type: 'local', command: 'npx', args: [], env: { API_KEY: '' } },
      [TEST_AGENT, TEST_AGENT_2],
      { API_KEY: 'sekrit-uninstall-cleanup' },
    )
    const vaultId = `${id}-api_key`
    expect(getBindings().find(b => b.vaultSecretId === vaultId)?.targets).toHaveLength(2)

    const results = uninstallCatalogItem(id, [TEST_AGENT])
    expect(results).toEqual([{ agent: TEST_AGENT, ok: true }])

    const binding = getBindings().find(b => b.vaultSecretId === vaultId && b.envVar === 'API_KEY')
    expect(binding).toBeDefined()
    expect(binding!.targets).toEqual([{ mcpFilePath: TEST_AGENT_2_MCP_PATH, serverName: id }])

    // The removed target is gone from the binding, so syncing it must NOT
    // report a "server not found" error for TEST_AGENT_MCP_PATH anymore.
    const syncResult = syncSecret(vaultId)
    expect(syncResult.errors).toEqual([])
    expect(syncResult.updated).toBe(1)

    // Removing the last remaining target should drop the binding entirely
    // (nothing left to sync) -- symmetric with the single-target case.
    uninstallCatalogItem(id, [TEST_AGENT_2])
    expect(getBindings().find(b => b.vaultSecretId === vaultId)).toBeUndefined()
  })

  it('rolls back the .mcp.json write when secret binding fails, so a retry is not blocked by the "already configured" guard', () => {
    // Codex review (2026-09-11, 2nd round): before this fix, a secret-binding
    // failure left the .mcp.json entry in place ("non-functional but
    // present") -- unrecoverable from the UI, since installedAgents then
    // includes the target (disabling its checkbox) and a retry POST hits the
    // explicit no-silent-overwrite guard. To exercise the REAL failure path
    // (not just its symptom), pre-seed a binding for this exact
    // (vaultId, envVar) that ALSO references a target file which does not
    // exist -- syncSecret() reports a "server not found" error for that
    // phantom target, which makes vaultAndBindEnvSecretsMultiTarget throw
    // AFTER installCatalogItem's own .mcp.json write for TEST_AGENT has
    // already succeeded, i.e. exactly the scenario the rollback branch
    // exists for.
    const id = freshId()
    const vaultId = `${id}-api_key`
    const phantomPath = join(TEST_AGENT_2_DIR, 'phantom-does-not-exist.mcp.json')
    addBinding({ vaultSecretId: vaultId, envVar: 'API_KEY', targets: [{ mcpFilePath: phantomPath, serverName: id }] })

    const results = installCatalogItem(
      { id, type: 'local', command: 'npx', args: [], env: { API_KEY: '' } },
      [TEST_AGENT],
      { API_KEY: 'sekrit-rollback-test' },
    )
    expect(results).toHaveLength(1)
    expect(results[0].agent).toBe(TEST_AGENT)
    expect(results[0].ok).toBe(false)
    expect(results[0].error).toMatch(/rolled back/i)

    // The .mcp.json write must have been rolled back -- no residue.
    const rolledBack = existsSync(TEST_AGENT_MCP_PATH) ? JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8')) : { mcpServers: {} }
    expect(rolledBack.mcpServers[id]).toBeUndefined()
    // The binding-target addition for TEST_AGENT must ALSO have been rolled
    // back -- only the pre-seeded phantom target remains.
    const binding = getBindings().find(b => b.vaultSecretId === vaultId && b.envVar === 'API_KEY')
    expect(binding?.targets).toEqual([{ mcpFilePath: phantomPath, serverName: id }])

    // A retry of the exact same install must now succeed -- proving the
    // rollback actually cleared the "already configured" residue and did not
    // leave the .mcp.json entry behind. Clear the synthetic phantom-binding
    // setup first so the retry's own secret sync doesn't hit the same
    // induced error again.
    removeBinding(vaultId, 'API_KEY')
    const retry = installCatalogItem(
      { id, type: 'local', command: 'npx', args: [], env: { API_KEY: '' } },
      [TEST_AGENT],
      { API_KEY: 'sekrit-rollback-test-retry' },
    )
    expect(retry).toEqual([{ agent: TEST_AGENT, ok: true }])
  })

  it('a failed install for an ADDITIONAL target restores the secret value and binding an already-installed target relies on', () => {
    // Codex review (2026-09-11, 3rd round): the first rollback cut only
    // undid THIS call's own new targets -- it never restored a shared
    // secret VALUE that this same call may have already overwritten via
    // setSecret() before failing. This reproduces exactly that: TEST_AGENT
    // gets a real, successful install first; a LATER call tries to ALSO
    // install to TEST_AGENT_2 under the SAME serverName+envVar with a
    // DIFFERENT secret value, and is forced to fail (same phantom-target
    // technique as above) AFTER the new value has already been persisted.
    const id = freshId()
    const first = installCatalogItem(
      { id, type: 'local', command: 'npx', args: [], env: { API_KEY: '' } },
      [TEST_AGENT],
      { API_KEY: 'original-value' },
    )
    expect(first).toEqual([{ agent: TEST_AGENT, ok: true }])
    const vaultId = `${id}-api_key`
    expect(getSecret(vaultId)).toBe('original-value')
    const bindingBefore = getBindings().find(b => b.vaultSecretId === vaultId && b.envVar === 'API_KEY')
    expect(bindingBefore?.targets).toEqual([{ mcpFilePath: TEST_AGENT_MCP_PATH, serverName: id }])

    // Force this call to fail via a phantom target added to the SAME
    // binding, merged in by vaultAndBindEnvSecretsMultiTarget's own
    // union-write before syncSecret() reports the phantom's "not found"
    // error and throws -- by which point setSecret() has ALREADY
    // overwritten the vaultId's value with 'overwriting-value' below.
    const phantomPath = join(TEST_AGENT_2_DIR, 'phantom-does-not-exist-2.mcp.json')
    addBinding({ ...bindingBefore!, targets: [...bindingBefore!.targets, { mcpFilePath: phantomPath, serverName: id }] })

    const second = installCatalogItem(
      { id, type: 'local', command: 'npx', args: [], env: { API_KEY: '' } },
      [TEST_AGENT_2],
      { API_KEY: 'overwriting-value' },
    )
    expect(second).toEqual([{ agent: TEST_AGENT_2, ok: false, error: expect.stringMatching(/rolled back/i) }])

    // The ORIGINAL target's secret VALUE must be restored -- not left
    // silently pointing at the second (failed) call's new value.
    expect(getSecret(vaultId)).toBe('original-value')
    // The binding must be restored to its exact pre-call shape: TEST_AGENT
    // plus the pre-seeded phantom target, but NOT TEST_AGENT_2 (the target
    // this failed call tried, and rolled back, to add).
    const bindingAfter = getBindings().find(b => b.vaultSecretId === vaultId && b.envVar === 'API_KEY')
    expect(bindingAfter?.targets).toEqual(expect.arrayContaining([
      { mcpFilePath: TEST_AGENT_MCP_PATH, serverName: id },
      { mcpFilePath: phantomPath, serverName: id },
    ]))
    expect(bindingAfter?.targets).toHaveLength(2)
    // TEST_AGENT_2's .mcp.json must have no trace of the failed install.
    const secondTargetFile = existsSync(TEST_AGENT_2_MCP_PATH) ? JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8')) : { mcpServers: {} }
    expect(secondTargetFile.mcpServers[id]).toBeUndefined()
    // TEST_AGENT's own file must still resolve to the restored value's ref
    // (the ref string never changes -- only the decrypted value did/does).
    const firstTargetFile = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    expect(firstTargetFile.mcpServers[id].env.API_KEY).toBe(`vault:${vaultId}`)

    // Clean up the synthetic phantom binding entry so it doesn't linger as
    // an unexpected extra target reference beyond this test.
    removeBinding(vaultId, 'API_KEY')
  })
})
