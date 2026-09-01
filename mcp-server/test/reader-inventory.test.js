import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetHubRoot } from '../lib/indexer.js'
import { findExamples, listResources } from '../lib/reader.js'

const hub = mkdtempSync(join(tmpdir(), 'b24-inventory-'))

function dir(rel) {
  const abs = join(hub, rel)
  mkdirSync(abs, { recursive: true })
  return abs
}

dir('examples/sdk-examples/php/quick-start')
writeFileSync(join(hub, 'examples/sdk-examples/php/quick-start/lead.php'), '<?php crm.lead.add webhook')
dir('examples/sdk-examples/js/02-nuxt-hook')
writeFileSync(join(hub, 'examples/sdk-examples/js/02-nuxt-hook/deal.js'), 'callMethod crm.deal.add')
dir('sdks/python/examples/scopes/crm.lead')
writeFileSync(
  join(hub, 'sdks/python/examples/scopes/crm.lead/crm_lead_add.md'),
  '# crm.lead.add\n\nclient.crm.lead.add(fields={})\n',
)
dir('sdks/php/src/Services/CRM')
dir('sdks/php/src/Services/Task')
writeFileSync(join(hub, 'sdks/php/src/Services/AbstractService.php'), '<?php')
dir('sdks/python/b24pysdk/scopes/crm')
dir('sdks/python/b24pysdk/scopes/task')
writeFileSync(join(hub, 'sdks/python/b24pysdk/scopes/user.py'), '')
writeFileSync(join(hub, 'sdks/python/b24pysdk/scopes/_base_entity.py'), '')
dir('sdks/js/packages/jssdk/src/hook')
dir('sdks/js/packages/jssdk/src/frame')
dir('sdks/js/packages/jssdk/src/types')
writeFileSync(join(hub, 'sdks/js/packages/jssdk/src/index.ts'), '')

process.env.B24_HUB_ROOT = hub
resetHubRoot()

after(() => {
  rmSync(hub, { recursive: true, force: true })
})

function useHub() {
  process.env.B24_HUB_ROOT = hub
  resetHubRoot()
}

test('findExamples(language=python) reads sdks/python/examples', async () => {
  useHub()
  const results = await findExamples('lead', 'python')
  assert.ok(results.length > 0, 'expected python examples')
  assert.ok(results.every(r => r.language === 'python'))
  assert.ok(results.some(r => r.path.includes('sdks/python/examples')))
})

test('findExamples(language=all) includes python alongside php/js', async () => {
  useHub()
  const results = await findExamples('lead', 'all')
  const langs = new Set(results.map(r => r.language))
  assert.ok(langs.has('python'), `langs=${[...langs]}`)
  assert.ok(langs.has('php') || langs.has('js'), `langs=${[...langs]}`)
})

test('listResources(examples) includes python/crm.lead', async () => {
  useHub()
  const items = await listResources('examples')
  assert.ok(items.includes('python/crm.lead'), items.join(', '))
  assert.ok(items.includes('php/quick-start'), items.join(', '))
})

test('listResources(sdk-services) prefixes php, python, and js', async () => {
  useHub()
  const items = await listResources('sdk-services')
  assert.ok(items.includes('php/CRM'), items.join(', '))
  assert.ok(items.includes('php/Task'), items.join(', '))
  assert.ok(!items.includes('AbstractService.php'))
  assert.ok(items.includes('python/crm'), items.join(', '))
  assert.ok(items.includes('python/user'), items.join(', '))
  assert.ok(!items.some(i => i.includes('_base_entity')), items.join(', '))
  assert.ok(items.includes('js/hook'), items.join(', '))
  assert.ok(items.includes('js/frame'), items.join(', '))
  assert.ok(!items.includes('js/types'), items.join(', '))
})
