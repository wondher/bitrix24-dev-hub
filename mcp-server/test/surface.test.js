import { test } from 'node:test'
import assert from 'node:assert/strict'
import { methodResourceUri, buildPrompt } from '../lib/surface.js'

test('methodResourceUri uses the b24://method/{name} template', () => {
  assert.equal(methodResourceUri('crm.lead.add'), 'b24://method/crm.lead.add')
  assert.equal(methodResourceUri('crm-lead-add'), 'b24://method/crm.lead.add')
})

test('buildPrompt spa-discovery names the live discovery tools', () => {
  const prompt = buildPrompt('spa-discovery', { entityTypeId: '152' })
  assert.equal(prompt.messages[0].role, 'user')
  const text = prompt.messages[0].content.text
  assert.match(text, /b24_call/)
  assert.match(text, /crm\.item\.entity-type\.list/)
  assert.match(text, /crm\.status\.list/)
  assert.match(text, /152/)
  assert.doesNotMatch(text, /crm\.dealcategory\.stage\.list/)
})

test('buildPrompt event-handler binds via event.bind, not as an event', () => {
  const prompt = buildPrompt('event-handler', { event: 'OnCrmLeadAdd' })
  const text = prompt.messages[0].content.text
  assert.match(text, /b24hub_api_event/)
  assert.match(text, /event\.bind/)
  assert.match(text, /OnCrmLeadAdd/)
})

test('buildPrompt local-app picks an SDK entry point', () => {
  const prompt = buildPrompt('local-app', { language: 'js' })
  const text = prompt.messages[0].content.text
  assert.match(text, /B24Hook|initializeB24Frame/)
  assert.match(text, /b24hub_sdk_ref/)
})
