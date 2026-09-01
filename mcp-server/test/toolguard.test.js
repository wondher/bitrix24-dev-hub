import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capText, withTimeout } from '../lib/toolguard.js'

test('capText leaves short strings alone', () => {
  assert.equal(capText('hello', 10), 'hello')
})

test('capText truncates long strings and notes how many chars were cut', () => {
  const out = capText('abcdefghij', 4)
  assert.ok(out.startsWith('abcd'))
  assert.ok(out.includes('truncated 6'))
})

test('withTimeout returns the handler result when it finishes in time', async () => {
  const wrapped = withTimeout(async () => ({
    content: [{ type: 'text', text: 'ok' }],
  }), 200, 'fast')
  const result = await wrapped({})
  assert.equal(result.content[0].text, 'ok')
})

test('withTimeout returns an error result instead of hanging', async () => {
  const wrapped = withTimeout(
    () => new Promise(() => {}),
    50,
    'stuck-tool'
  )
  const result = await wrapped({})
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /stuck-tool/)
  assert.match(result.content[0].text, /timed out/)
})
