import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, stem } from '../lib/search.js'

test('tokenize splits on whitespace and lowercases', () => {
  assert.deepEqual(tokenize('Lead Service'), ['lead', 'service'])
})

test('tokenize splits camelCase', () => {
  assert.deepEqual(tokenize('LeadService'), ['lead', 'service'])
})

test('tokenize splits PascalCase', () => {
  assert.deepEqual(tokenize('B24Hook'), ['b24', 'hook'])
})

test('tokenize splits on dot notation (API methods)', () => {
  assert.deepEqual(tokenize('crm.lead.add'), ['crm', 'lead', 'add'])
})

test('tokenize splits on kebab and snake case', () => {
  assert.deepEqual(tokenize('lead-service'), ['lead', 'service'])
  assert.deepEqual(tokenize('lead_service'), ['lead', 'service'])
})

test('tokenize removes stopwords', () => {
  const tokens = tokenize('the Lead is in the CRM')
  assert.ok(!tokens.includes('the'))
  assert.ok(!tokens.includes('is'))
  assert.ok(tokens.includes('lead'))
  assert.ok(tokens.includes('crm'))
})

test('tokenize drops single chars and empty', () => {
  assert.deepEqual(tokenize(''), [])
  assert.deepEqual(tokenize('a b c'), [])
})

test('stem collapses common English suffixes', () => {
  assert.equal(stem('leads'), 'lead')
  assert.equal(stem('creating'), 'creat')
  assert.equal(stem('created'), 'creat')
})

test('stem does not strip double-s endings', () => {
  // Words ending in 'ss' should be preserved (protects 'class', 'process').
  assert.equal(stem('class'), 'class')
  assert.equal(stem('process'), 'process')
})

test('tokenize handles mixed case identifiers', () => {
  const tokens = tokenize('ServiceBuilderFactory')
  assert.ok(tokens.includes('service'))
  assert.ok(tokens.includes('builder'))
  assert.ok(tokens.includes('factory'))
})
