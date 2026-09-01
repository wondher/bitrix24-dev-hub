import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FORBIDDEN = 'crm.dealcategory.stage.list'

async function readHub(rel) {
  return readFile(join(hubRoot, rel), 'utf-8')
}

test('AGENTS.md is a tool router, not a catalog titled CLAUDE.md', async () => {
  const agents = await readHub('AGENTS.md')
  assert.doesNotMatch(agents, /^# CLAUDE\.md/m)
  assert.doesNotMatch(agents, new RegExp(FORBIDDEN.replace(/\./g, '\\.')))
  assert.match(agents, /crm\.status\.list/)
  assert.match(agents, /b24hub_api_method/)
  assert.match(agents, /b24_call/)
  assert.match(agents, /\.cursor\/skills\/b24-dev-hub\/SKILL\.md/)
})

test('README points at AGENTS.md and uses crm.status.list for stages', async () => {
  const readme = await readHub('README.md')
  assert.doesNotMatch(readme, /\[`?CLAUDE\.md`?\]/)
  assert.match(readme, /AGENTS\.md/)
  assert.doesNotMatch(readme, new RegExp(FORBIDDEN.replace(/\./g, '\\.')))
  assert.match(readme, /crm\.status\.list/)
})

test('b24_call description, confirm, paging, and MCP surface stay aligned', async () => {
  const index = await readHub('mcp-server/index.js')
  assert.doesNotMatch(index, new RegExp(FORBIDDEN.replace(/\./g, '\\.')))
  assert.match(index, /crm\.status\.list/)
  assert.match(index, /confirm:\s*true/)
  assert.match(index, /offset/)
  assert.match(index, /spa-discovery/)
  assert.match(index, /b24:\/\/method/)
  assert.match(index, /formatCatalog/)
  assert.match(index, /field === ['"]markdown['"]/)
})
