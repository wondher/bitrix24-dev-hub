import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildIndex, searchIndex } from '../lib/indexer.js'

/**
 * Construct a fake hub layout with one markdown doc under docs/rest-api.
 * buildIndex() tolerates missing CATEGORY_MAP dirs, so a single dir is enough.
 */
async function makeFakeHub() {
  const hub = await mkdtemp(join(tmpdir(), 'b24-idx-'))
  const apiDir = join(hub, 'docs/rest-api/api-reference/crm')
  await mkdir(apiDir, { recursive: true })
  await writeFile(
    join(apiDir, 'crm-lead-add.md'),
    '# crm.lead.add\n\nCreates a new lead in CRM.\n\n## Parameters\n\nfields[NAME]\n'
  )
  await writeFile(
    join(apiDir, 'crm-deal-get.md'),
    '# crm.deal.get\n\nReturns a deal by ID.\n'
  )
  return hub
}

test('buildIndex indexes markdown files with title + snippet', async (t) => {
  const hub = await makeFakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = await buildIndex(hub)
  assert.equal(index.stats.total, 2)
  assert.ok(index.stats.byCategory.api >= 2)
  const titles = index.entries.map(e => e.title)
  assert.ok(titles.includes('crm.lead.add'))
  assert.ok(titles.includes('crm.deal.get'))
})

test('buildIndex produces an inverted index with expected terms', async (t) => {
  const hub = await makeFakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = await buildIndex(hub)
  assert.ok(index.inverted.lead instanceof Map, '"lead" should be an indexed term')
  assert.ok(index.inverted.lead.size > 0)
  assert.ok(index.inverted.crm instanceof Map)
  assert.ok(index.avgDocLength > 0)
})

test('searchIndex finds documents by query term', async (t) => {
  const hub = await makeFakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = await buildIndex(hub)
  const results = searchIndex(index, 'crm lead add')
  assert.ok(results.length > 0)
  assert.equal(results[0].title, 'crm.lead.add', 'exact doc should rank first')
})

test('searchIndex "lead" surfaces the lead doc in top results', async (t) => {
  const hub = await makeFakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = await buildIndex(hub)
  const results = searchIndex(index, 'lead')
  assert.ok(results.length > 0)
  const top = results.slice(0, 3).map(r => r.title)
  assert.ok(top.includes('crm.lead.add'), '"lead" should surface the lead doc')
})

test('searchIndex respects scope filter', async (t) => {
  const hub = await makeFakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = await buildIndex(hub)
  // All docs are in 'api' scope; querying 'sdk' should return nothing.
  const results = searchIndex(index, 'lead', { scope: 'sdk' })
  assert.equal(results.length, 0)
})

test('searchIndex scores are numeric and finite', async (t) => {
  const hub = await makeFakeHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = await buildIndex(hub)
  const results = searchIndex(index, 'lead')
  for (const r of results) {
    assert.equal(typeof r.score, 'number')
    assert.ok(Number.isFinite(r.score))
    assert.ok(r.score > 0)
  }
})

test('buildIndex excludes test files', async (t) => {
  const hub = await mkdtemp(join(tmpdir(), 'b24-test-idx-'))
  t.after(() => rm(hub, { recursive: true, force: true }))
  const apiDir = join(hub, 'docs/rest-api/api-reference/crm')
  await mkdir(apiDir, { recursive: true })
  await writeFile(join(apiDir, 'crm-lead-add.md'), '# crm.lead.add\n\nlead\n')
  await mkdir(join(apiDir, 'tests'), { recursive: true })
  await writeFile(join(apiDir, 'tests/LeadTest.php'), '<?php class LeadTest {} lead lead\n')
  await writeFile(join(apiDir, 'lead.spec.js'), 'export const lead = () => {} lead\n')

  const index = await buildIndex(hub)
  const paths = index.entries.map(e => e.path)
  assert.ok(paths.some(p => p.endsWith('crm-lead-add.md')), 'real doc is indexed')
  assert.ok(!paths.some(p => p.includes('LeadTest')), 'test class file is excluded')
  assert.ok(!paths.some(p => p.endsWith('lead.spec.js')), 'spec file is excluded')
})
