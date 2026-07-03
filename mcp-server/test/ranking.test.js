import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInvertedIndex, rank, snippetFor, tokenize } from '../lib/search.js'

/**
 * Build a minimal index from a set of {title, content} docs.
 */
function makeIndex(docs) {
  const docsWithTokens = docs.map((d, i) => ({
    id: i,
    title: d.title,
    path: d.path || `${d.title.toLowerCase()}.md`,
    category: d.category || 'api',
    language: d.language || 'markdown',
    snippet: d.snippet || '',
    size: d.content.length,
    tokens: tokenize(`${d.title} ${d.content}`),
  }))
  const { inverted, docLengths, avgDocLength } = buildInvertedIndex(docsWithTokens)
  return {
    entries: docsWithTokens.map(({ tokens, ...rest }) => rest),
    inverted,
    docLengths,
    avgDocLength,
    stats: { total: docs.length, byCategory: { api: docs.length } },
  }
}

test('rank returns results in descending score order', () => {
  const index = makeIndex([
    { title: 'Lead', content: 'lead lead lead deal contact' },
    { title: 'Contact', content: 'lead contact once' },
  ])
  const results = rank('lead', index)
  assert.equal(results.length, 2)
  assert.ok(results[0].score >= results[1].score)
  // Doc with more 'lead' occurrences should rank first.
  assert.equal(results[0].title, 'Lead')
})

test('rank applies title-match bonus', () => {
  const index = makeIndex([
    { title: 'Lead', content: 'lead' },
    { title: 'Misc', content: 'lead mentioned once in passing' },
  ])
  const results = rank('lead', index)
  assert.equal(results[0].title, 'Lead', 'doc titled "Lead" should win')
})

test('rank respects scope filter', () => {
  const index = makeIndex([
    { title: 'Lead', content: 'lead', category: 'api' },
    { title: 'LeadView', content: 'lead', category: 'ui' },
  ])
  const results = rank('lead', index, { scope: 'ui' })
  assert.equal(results.length, 1)
  assert.equal(results[0].title, 'LeadView')
})

test('rank respects language filter', () => {
  const index = makeIndex([
    { title: 'Lead', content: 'lead', language: 'markdown' },
    { title: 'Lead', content: 'lead', language: 'php' },
  ])
  const results = rank('lead', index, { language: 'php' })
  assert.equal(results.length, 1)
  assert.equal(results[0].language, 'php')
})

test('rank respects limit', () => {
  const index = makeIndex([
    { title: 'a', content: 'lead' },
    { title: 'b', content: 'lead' },
    { title: 'c', content: 'lead' },
  ])
  const results = rank('lead', index, { limit: 2 })
  assert.equal(results.length, 2)
})

test('rank returns empty for no matches', () => {
  const index = makeIndex([{ title: 'Lead', content: 'lead' }])
  assert.deepEqual(rank('nonexistentterm', index), [])
})

test('rank handles multi-term queries', () => {
  const index = makeIndex([
    { title: 'CRM Lead Add', content: 'add a lead to crm' },
    { title: 'Lead', content: 'lead only' },
    { title: 'Add', content: 'add only' },
  ])
  const results = rank('crm lead add', index)
  // The doc mentioning all three terms should rank first.
  assert.equal(results[0].title, 'CRM Lead Add')
})

test('rank returns no results for stopwords-only query', () => {
  const index = makeIndex([{ title: 'Lead', content: 'the lead' }])
  assert.deepEqual(rank('the', index), [])
})

test('snippetFor centers on the query term match', () => {
  const content = 'line one\nline two with lead here\nline three'
  const snippet = snippetFor('lead', content, 'fallback')
  assert.ok(snippet.includes('lead'))
  assert.ok(!snippet.startsWith('line one'))
})

test('snippetFor falls back when no term matches', () => {
  const snippet = snippetFor('zzz', 'no match here', 'the fallback')
  assert.equal(snippet, 'the fallback')
})

test('snippetFor falls back to truncated content when no fallback given', () => {
  const snippet = snippetFor('zzz', 'no match here', '')
  assert.ok(snippet.length > 0)
})
