import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetHubRoot } from '../lib/indexer.js'
import { parseScopeCodes, listResources } from '../lib/reader.js'

const SAMPLE = `
# Available Scopes

|| **Scope Code** | **Scope Name**||
|| **crm** | CRM ||
|| **task** | Tasks ||
|| **sonet_group, socialnetwork** | Groups ||
|| **user.userfield** | User custom fields ||
`

const fixtureHub = mkdtempSync(join(tmpdir(), 'b24-scopes-'))
mkdirSync(join(fixtureHub, 'docs/rest-api/api-reference/scopes'), { recursive: true })
writeFileSync(
  join(fixtureHub, 'docs/rest-api/api-reference/scopes/permissions.md'),
  SAMPLE,
)

after(() => {
  rmSync(fixtureHub, { recursive: true, force: true })
})

function useFixtureHub() {
  process.env.B24_HUB_ROOT = fixtureHub
  resetHubRoot()
}

test('parseScopeCodes extracts bold scope codes from the permissions table', () => {
  const codes = parseScopeCodes(SAMPLE)
  assert.ok(codes.includes('crm'))
  assert.ok(codes.includes('task'))
  assert.ok(codes.includes('user.userfield'))
})

test('parseScopeCodes splits comma-separated codes on one row', () => {
  const codes = parseScopeCodes(SAMPLE)
  assert.ok(codes.includes('sonet_group'))
  assert.ok(codes.includes('socialnetwork'))
})

test('parseScopeCodes ignores table header rows', () => {
  const codes = parseScopeCodes(SAMPLE)
  assert.ok(!codes.includes('Scope Code'))
})

test('listResources(sdk-scopes) reads permissions.md, not a missing scopes/ folder', async () => {
  useFixtureHub()
  const items = await listResources('sdk-scopes')
  assert.deepEqual(items, ['crm', 'socialnetwork', 'sonet_group', 'task', 'user.userfield'].sort())
})

test('listResources(sdk-scopes) filter matches substring of a code', async () => {
  useFixtureHub()
  const items = await listResources('sdk-scopes', 'user')
  assert.deepEqual(items, ['user.userfield'])
})
