import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headingOutline, pageText, formatDocPage, DEFAULT_PAGE_CHARS } from '../lib/paginate.js'

const DOC = [
  '# Title',
  '',
  'intro paragraph',
  '',
  '## Method Parameters',
  '',
  'fields go here',
  '',
  '## Error Handling',
  '',
  'access denied',
].join('\n')

test('headingOutline lists markdown headings with character offsets', () => {
  const outline = headingOutline(DOC)
  assert.equal(outline[0].title, 'Title')
  assert.equal(outline[0].level, 1)
  assert.equal(outline[0].offset, 0)
  assert.equal(outline[1].title, 'Method Parameters')
  assert.equal(outline[2].title, 'Error Handling')
  assert.ok(outline[2].offset > outline[1].offset)
})

test('pageText slices from offset and reports nextOffset', () => {
  const page = pageText('abcdefghij', { offset: 2, limit: 4 })
  assert.equal(page.text, 'cdef')
  assert.equal(page.total, 10)
  assert.equal(page.offset, 2)
  assert.equal(page.nextOffset, 6)
})

test('pageText nextOffset is null on the last page', () => {
  const page = pageText('abcdefghij', { offset: 8, limit: 4 })
  assert.equal(page.text, 'ij')
  assert.equal(page.nextOffset, null)
})

test('formatDocPage puts outline and next-page hint above the slice', () => {
  const out = formatDocPage({
    title: 'crm.lead.add',
    path: 'docs/rest-api/api-reference/crm/leads/crm-lead-add.md',
    content: DOC,
    offset: 0,
    limit: 40,
  })
  assert.match(out, /crm\.lead\.add/)
  assert.match(out, /Method Parameters/)
  assert.match(out, /Error Handling/)
  assert.match(out, /offset=\d+/)
  assert.ok(out.includes('# Title'))
  assert.ok(out.length < DOC.length + 800)
})

test('DEFAULT_PAGE_CHARS is well under the 80k hard cap', () => {
  assert.ok(DEFAULT_PAGE_CHARS >= 4000)
  assert.ok(DEFAULT_PAGE_CHARS <= 20_000)
})
