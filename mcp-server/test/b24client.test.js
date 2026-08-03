import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWebhookUrl,
  formatB24Result,
  normalizeConfig,
  validateConfig,
} from '../lib/b24client.js'

const FLAT = {
  baseUrl: 'https://maxipas.bitrix24.com.br',
  userId: '89',
  webhookToken: 'sekret',
}

// ── buildWebhookUrl ──────────────────────────────────────────

test('buildWebhookUrl builds the canonical webhook path', () => {
  const url = buildWebhookUrl(FLAT, 'crm.item.list')
  assert.equal(
    url,
    'https://maxipas.bitrix24.com.br/rest/89/sekret/crm.item.list.json'
  )
})

test('buildWebhookUrl strips trailing slashes from baseUrl', () => {
  const url = buildWebhookUrl({ ...FLAT, baseUrl: 'https://x.bitrix24.com.br///' }, 'user.get')
  assert.equal(url, 'https://x.bitrix24.com.br/rest/89/sekret/user.get.json')
})

test('buildWebhookUrl strips a leading slash and any .json suffix on the method', () => {
  const a = buildWebhookUrl(FLAT, '/tasks.task.list')
  const b = buildWebhookUrl(FLAT, 'tasks.task.list.json')
  assert.equal(a, b)
  assert.equal(a, 'https://maxipas.bitrix24.com.br/rest/89/sekret/tasks.task.list.json')
})

// ── normalizeConfig ──────────────────────────────────────────

test('normalizeConfig: flat shape is passed through with the active profile', () => {
  const out = normalizeConfig(FLAT)
  assert.equal(out.baseUrl, FLAT.baseUrl)
  assert.equal(out.userId, FLAT.userId)
  assert.equal(out.webhookToken, FLAT.webhookToken)
  assert.equal(out.profile, 'default')
})

test('normalizeConfig: profiles shape selects the requested profile', () => {
  const parsed = {
    profiles: {
      default: { ...FLAT, webhookToken: 'tok-default' },
      prod: { ...FLAT, webhookToken: 'tok-prod' },
    },
  }
  assert.equal(normalizeConfig(parsed, 'prod').webhookToken, 'tok-prod')
  assert.equal(normalizeConfig(parsed, 'default').webhookToken, 'tok-default')
})

test('normalizeConfig: unknown profile throws listing available ones', () => {
  const parsed = { profiles: { default: FLAT, prod: FLAT } }
  assert.throws(
    () => normalizeConfig(parsed, 'staging'),
    /"staging" not found.*default, prod/
  )
})

// ── validateConfig ───────────────────────────────────────────

test('validateConfig rejects non-https baseUrl', () => {
  assert.throws(
    () => validateConfig({ ...FLAT, baseUrl: 'http://insecure.bitrix24.com.br' }),
    /must start with "https:\/\//
  )
})

test('validateConfig rejects non-numeric userId', () => {
  assert.throws(
    () => validateConfig({ ...FLAT, userId: 'abc' }),
    /"userId".*positive integer/
  )
})

test('validateConfig accepts numeric-string userId', () => {
  validateConfig({ ...FLAT, userId: '89' }) // does not throw
  validateConfig({ ...FLAT, userId: 89 }) // does not throw
})

test('validateConfig rejects empty webhookToken', () => {
  assert.throws(
    () => validateConfig({ ...FLAT, webhookToken: '   ' }),
    /"webhookToken".*non-empty/
  )
})

// ── formatB24Result ──────────────────────────────────────────

test('formatB24Result shows total + next-page hint when paginating', () => {
  const out = formatB24Result('crm.item.list', {
    result: [{ id: 1 }, { id: 2 }],
    total: 75,
    next: 50,
  }, 0)
  assert.match(out, /✅ `crm.item.list`/)
  assert.match(out, /📊 Total: 75/)
  assert.match(out, /📌 Next page: call again with `start: 50`/)
  assert.match(out, /showing 0–49 of 75/)
  assert.match(out, /```json/)
})

test('formatB24Result shows no pagination block when next is absent', () => {
  const out = formatB24Result('app.info', { result: { version: '22.400.0' } })
  assert.doesNotMatch(out, /Next page/)
  assert.doesNotMatch(out, /Total/)
  assert.match(out, /"version": "22\.400\.0"/)
})

test('formatB24Result truncates payloads over the soft cap', () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ id: i }))
  const out = formatB24Result('crm.item.list', { result: big }, 0)
  assert.match(out, /\[truncated \d+ chars/)
})
