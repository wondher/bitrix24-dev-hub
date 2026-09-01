import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyB24Method, assertMutationAllowed } from '../lib/liveguard.js'

test('classifyB24Method treats list/get/fields/info as read', () => {
  for (const method of [
    'crm.item.list',
    'crm.status.list',
    'crm.lead.get',
    'crm.item.fields',
    'app.info',
    'user.current',
    'event.get',
  ]) {
    assert.equal(classifyB24Method(method), 'read', method)
  }
})

test('classifyB24Method treats add/update/delete/bind/batch as write', () => {
  for (const method of [
    'crm.lead.add',
    'crm.item.update',
    'crm.deal.delete',
    'event.bind',
    'bizproc.workflow.start',
    'disk.file.upload',
    'batch',
    'app.option.set',
  ]) {
    assert.equal(classifyB24Method(method), 'write', method)
  }
})

test('assertMutationAllowed lets reads through without confirm', () => {
  assert.equal(assertMutationAllowed('crm.item.list', false), null)
  assert.equal(assertMutationAllowed('app.info', undefined), null)
})

test('assertMutationAllowed blocks writes until confirm is true', () => {
  const blocked = assertMutationAllowed('crm.lead.add', false)
  assert.ok(blocked)
  assert.match(blocked, /confirm:\s*true/)
  assert.match(blocked, /crm\.lead\.add/)
  assert.equal(assertMutationAllowed('crm.lead.add', true), null)
})
