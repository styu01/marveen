import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AGENTS_BASE_DIR } from '../web/agent-config.js'
import { tryHandleConnectors } from '../web/routes/connectors.js'
import type { RouteContext } from '../web/routes/types.js'

// Runtime (HTTP-level) tests for POST /api/mcp-catalog/:id/install and
// DELETE /api/mcp-catalog/:id/uninstall (kanban 24152d84, 2026-09-11) --
// mcp-catalog-install-target.test.ts covers the underlying functions
// directly; these exercise the actual route parsing (body/query, error
// codes) the frontend talks to. Every test here targets throwaway
// sub-agent directories under AGENTS_BASE_DIR -- never PROJECT_ROOT/.mcp.json,
// which is this checkout's own live MCP config, worktree or not.

// Codex review (2026-09-11, 2nd round): a fixed test-agent directory name,
// unconditionally rmSync'd at suite start, is itself a small destructive-test
// risk. A per-run random suffix makes collision astronomically unlikely, and
// createFreshTestAgentDir below fails LOUDLY instead of deleting anything it
// didn't itself create.
const RUN = randomUUID().slice(0, 8)
const TEST_AGENT = `mcp-route-test-agent-${RUN}`
const TEST_AGENT_2 = `mcp-route-test-agent-2-${RUN}`
const TEST_AGENT_DIR = join(AGENTS_BASE_DIR, TEST_AGENT)
const TEST_AGENT_2_DIR = join(AGENTS_BASE_DIR, TEST_AGENT_2)
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

// mcp-catalog.json lookup happens against the REAL repo catalog file (not
// mocked/seeded here) -- pick an id that is virtually certain to exist in
// any reasonably current catalog, same assumption other route tests in this
// codebase make about real config files being present in the checkout.
// If this ever breaks because the catalog no longer has this id, swap it
// for another local-type entry from seed-scheduled-tasks/../mcp-catalog.json.
const KNOWN_LOCAL_ITEM_ID = 'filesystem'

function fakeCtx(method: 'POST' | 'DELETE', path: string, body?: unknown): { ctx: RouteContext; res: { statusCode: number; body: string } } {
  const req = new EventEmitter() as unknown as RouteContext['req'] & { destroy(): void }
  ;(req as unknown as { headers: Record<string, string> }).headers = {}
  ;(req as { destroy(): void }).destroy = () => {}
  const state = { statusCode: 0, body: '' }
  const res = {
    writeHead(code: number) { state.statusCode = code; return res },
    end(data?: unknown) { state.body = String(data ?? '') },
    setHeader() {},
  } as unknown as RouteContext['res']
  process.nextTick(() => {
    ;(req as unknown as EventEmitter).emit('data', Buffer.from(body !== undefined ? JSON.stringify(body) : ''))
    ;(req as unknown as EventEmitter).emit('end')
  })
  const url = new URL(`http://localhost${path}`)
  return { ctx: { req, res, path: url.pathname, method, url, fedPeer: null }, res: state }
}

async function call(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ statusCode: number; json: unknown }> {
  const { ctx, res } = fakeCtx(method, path, body)
  const handled = await tryHandleConnectors(ctx)
  expect(handled).toBe(true)
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

function cleanupTestAgentMcpJsons() {
  try { rmSync(TEST_AGENT_MCP_PATH) } catch { /* did not exist */ }
  try { rmSync(TEST_AGENT_2_MCP_PATH) } catch { /* did not exist */ }
}

beforeAll(() => {
  createFreshTestAgentDir(TEST_AGENT_DIR, {})
  createFreshTestAgentDir(TEST_AGENT_2_DIR, {})
})

afterEach(() => {
  cleanupTestAgentMcpJsons()
})

afterAll(() => {
  cleanupTestAgentMcpJsons()
  rmSync(TEST_AGENT_DIR, { recursive: true, force: true })
  rmSync(TEST_AGENT_2_DIR, { recursive: true, force: true })
})

describe('POST /api/mcp-catalog/:id/install (runtime)', () => {
  it('requires an explicit, non-empty agents array -- no implicit default target', async () => {
    const r = await call('POST', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/install`, { env: {} })
    expect(r.statusCode).toBe(400)
    expect(String((r.json as { error?: string })?.error)).toMatch(/agents/i)
  })

  it('404s for an unknown catalog id, even with a valid agents array', async () => {
    const r = await call('POST', '/api/mcp-catalog/definitely-not-a-real-catalog-item-zzz/install', { agents: [TEST_AGENT] })
    expect(r.statusCode).toBe(404)
  })

  it('rejects an unknown target agent with 400 before writing anything', async () => {
    const r = await call('POST', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/install`, { agents: ['not-a-real-agent-zzz'] })
    expect(r.statusCode).toBe(400)
    expect(existsSync(TEST_AGENT_MCP_PATH)).toBe(false)
  })

  it('installs into the target agent and writes a real .mcp.json entry', async () => {
    const r = await call('POST', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/install`, { agents: [TEST_AGENT], env: {} })
    expect(r.statusCode).toBe(200)
    expect((r.json as { ok?: boolean }).ok).toBe(true)
    const written = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    expect(written.mcpServers[KNOWN_LOCAL_ITEM_ID]).toBeDefined()
  })

  it('installs into multiple targets in one call', async () => {
    const r = await call('POST', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/install`, { agents: [TEST_AGENT, TEST_AGENT_2], env: {} })
    expect(r.statusCode).toBe(200)
    expect(existsSync(TEST_AGENT_MCP_PATH)).toBe(true)
    expect(existsSync(TEST_AGENT_2_MCP_PATH)).toBe(true)
  })
})

describe('DELETE /api/mcp-catalog/:id/uninstall (runtime)', () => {
  it('requires the agents query param -- no implicit default target', async () => {
    const r = await call('DELETE', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/uninstall`)
    expect(r.statusCode).toBe(400)
    expect(String((r.json as { error?: string })?.error)).toMatch(/agents/i)
  })

  it('404s for an unknown catalog id', async () => {
    const r = await call('DELETE', `/api/mcp-catalog/definitely-not-a-real-catalog-item-zzz/uninstall?agents=${TEST_AGENT}`)
    expect(r.statusCode).toBe(404)
  })

  it('removes an installed entry from the targeted agent only', async () => {
    await call('POST', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/install`, { agents: [TEST_AGENT, TEST_AGENT_2], env: {} })
    const r = await call('DELETE', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/uninstall?agents=${TEST_AGENT}`)
    expect(r.statusCode).toBe(200)
    const firstWritten = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    expect(firstWritten.mcpServers[KNOWN_LOCAL_ITEM_ID]).toBeUndefined()
    const secondWritten = JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8'))
    expect(secondWritten.mcpServers[KNOWN_LOCAL_ITEM_ID]).toBeDefined() // untouched
  })

  it('supports multiple comma-separated targets', async () => {
    await call('POST', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/install`, { agents: [TEST_AGENT, TEST_AGENT_2], env: {} })
    const r = await call('DELETE', `/api/mcp-catalog/${KNOWN_LOCAL_ITEM_ID}/uninstall?agents=${TEST_AGENT},${TEST_AGENT_2}`)
    expect(r.statusCode).toBe(200)
    const firstWritten = JSON.parse(readFileSync(TEST_AGENT_MCP_PATH, 'utf-8'))
    const secondWritten = JSON.parse(readFileSync(TEST_AGENT_2_MCP_PATH, 'utf-8'))
    expect(firstWritten.mcpServers[KNOWN_LOCAL_ITEM_ID]).toBeUndefined()
    expect(secondWritten.mcpServers[KNOWN_LOCAL_ITEM_ID]).toBeUndefined()
  })
})
