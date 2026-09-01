import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
process.env.B24_HUB_ROOT = hubRoot

const { resetHubRoot } = await import('../lib/indexer.js')
resetHubRoot()

const corpusReady = existsSync(join(hubRoot, 'docs/rest-api/api-reference/scopes/permissions.md'))
  && existsSync(join(hubRoot, 'docs/rest-api/api-reference/crm/leads/crm-lead-add.md'))
  && existsSync(join(hubRoot, 'sdks/php/src/Services/ServiceBuilderFactory.php'))
  && existsSync(join(hubRoot, 'sdks/js/packages/jssdk/src/hook/b24.ts'))
  && existsSync(join(hubRoot, 'sdks/python/b24pysdk/client.py'))
  && existsSync(join(hubRoot, 'ui/components/src/runtime/components/Button.vue'))

const skip = corpusReady ? false : 'hub submodules not checked out (CI fixtures only)'

const {
  findApiMethod,
  findApiEvent,
  findSdkReference,
  findUiComponent,
  findExamples,
  listResources,
} = await import('../lib/reader.js')
const { parseMethodDoc, formatCatalog } = await import('../lib/catalog.js')

test('crm.lead.add resolves to the lead-add method doc', { skip }, async () => {
  const result = await findApiMethod('crm.lead.add')
  assert.ok(result, 'expected a method match')
  assert.match(result.path, /crm-lead-add\.md$/)
})

test('crm.status.list is the stages method (not crm.stage.list)', { skip }, async () => {
  const result = await findApiMethod('crm.status.list')
  assert.ok(result, 'expected a method match')
  assert.match(result.path, /crm-status-list\.md$/)
})

test('crm.item.list resolves to the universal item list doc', { skip }, async () => {
  const result = await findApiMethod('crm.item.list')
  assert.ok(result, 'expected a method match')
  assert.match(result.path, /crm-item-list\.md$/)
})

test('event.bind is a REST method, not an event', { skip }, async () => {
  const result = await findApiMethod('event.bind')
  assert.ok(result, 'expected a method match')
  assert.match(result.path, /event-bind\.md$/)
})

test('OnCrmLeadAdd resolves to the lead-add event doc', { skip }, async () => {
  const result = await findApiEvent('OnCrmLeadAdd')
  assert.ok(result, 'expected an event match')
  assert.match(result.path, /leads\/events\/on-crm-lead-add\.md$/)
})

test('Button resolves to the UI Kit Vue component', { skip }, async () => {
  const result = await findUiComponent('Button')
  assert.ok(result, 'expected a component match')
  assert.match(result.path, /Button\.vue$/)
})

test('B24Hook in the JS SDK is the webhook entry point', { skip }, async () => {
  const result = await findSdkReference('B24Hook', 'js')
  assert.ok(result, 'expected an SDK match')
  assert.match(result.path, /hook\/b24\.ts$/)
  assert.match(result.content, /export class B24Hook/)
})

test('ServiceBuilderFactory is the PHP SDK entry point', { skip }, async () => {
  const result = await findSdkReference('ServiceBuilderFactory', 'php')
  assert.ok(result, 'expected an SDK match')
  assert.match(result.path, /ServiceBuilderFactory\.php$/)
})

test('Client is the Python SDK entry module', { skip }, async () => {
  const result = await findSdkReference('Client', 'python')
  assert.ok(result, 'expected an SDK match')
  assert.match(result.path, /b24pysdk\/client\.py$/)
})

test('sdk-scopes lists real REST permission codes', { skip }, async () => {
  const items = await listResources('sdk-scopes')
  for (const code of ['crm', 'task', 'user']) {
    assert.ok(items.includes(code), `expected scope "${code}" in ${items.slice(0, 12).join(', ')}…`)
  }
  assert.ok(items.includes('sonet_group'))
  assert.ok(items.includes('socialnetwork'))
})

test('findExamples(python) hits sdks/python/examples', { skip }, async () => {
  const results = await findExamples('lead', 'python')
  assert.ok(results.length > 0)
  assert.ok(results.some(r => r.path.includes('sdks/python/examples')))
})

test('sdk-services lists php, python, and js prefixes', { skip }, async () => {
  const items = await listResources('sdk-services')
  assert.ok(items.includes('php/CRM'), items.slice(0, 8).join(', '))
  assert.ok(items.includes('python/crm'), items.slice(0, 8).join(', '))
  assert.ok(items.includes('js/hook'), items.join(', '))
})

test('crm.lead.add catalog lists TITLE and does not dump the raw markdown page', { skip }, async () => {
  const result = await findApiMethod('crm.lead.add')
  const entry = parseMethodDoc({
    content: result.content,
    path: result.path,
    method: 'crm.lead.add',
  })
  const names = (entry.params.find(p => p.name === 'fields')?.fields || []).map(f => f.name)
  assert.ok(names.includes('TITLE'), names.slice(0, 12).join(', '))
  const text = formatCatalog(entry)
  assert.match(text, /Method: crm\.lead\.add/)
  assert.match(text, /Scope: crm/)
  assert.doesNotMatch(text, /\{% include/)
})

test('SKILL.md routes stages to crm.status.list', async () => {
  const skillPath = join(hubRoot, '.cursor/skills/b24-dev-hub/SKILL.md')
  assert.ok(existsSync(skillPath), 'project skill must be versioned at .cursor/skills/b24-dev-hub/SKILL.md')
  const skill = await readFile(skillPath, 'utf-8')
  assert.match(skill, /crm\.status\.list/)
  assert.doesNotMatch(skill, /crm\.dealcategory\.stage\.list/)
  for (const tool of [
    'b24hub_search',
    'b24hub_list',
    'b24hub_grep',
    'b24hub_get',
    'b24hub_api_method',
    'b24hub_api_event',
    'b24hub_sdk_ref',
    'b24hub_ui_component',
    'b24hub_examples',
    'b24_call',
  ]) {
    assert.ok(skill.includes(tool), `skill must name ${tool}`)
  }
})
