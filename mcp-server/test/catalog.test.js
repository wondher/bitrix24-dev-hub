import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseYfmTable,
  paramRowsFromTable,
  parseMethodDoc,
  formatCatalog,
  firstYfmTableInner,
} from '../lib/catalog.js'

const FIXTURE = `# Create a New Lead crm.lead.add

> Scope: [\`crm\`](../../scopes/permissions.md)
>
> Who can execute the method: any user with permission to create leads

{% note warning "DEPRECATED" %}

The development of this method has been halted. Please use [crm.item.add](../universal/crm-item-add.md).

{% endnote %}

The method \`crm.lead.add\` creates a new lead.

## Method Parameters

#|
|| **Name**
\`type\` | **Description** ||
|| **fields**
[\`object\`](../../data-types.md) | Object format with lead values ||
|| **params**
[\`object\`](../../data-types.md) | Optional array of options ||
|#

### Parameter fields {#fields}
#|
|| **Name**
\`type\` | **Description** ||
|| **TITLE**
[\`string\`](../../data-types.md) | Lead title ||
|| **STATUS_ID**
[\`crm_status\`](../data-types.md) | Identifier of the lead stage ||
|| **PHONE**
[\`crm_multifield\`](../data-types.md) | Phone. Multiple ||
|#

### Parameter params {#params}
#|
|| **Name**
\`type\`  | **Description** ||
|| **REGISTER_SONET_EVENT**
[\`boolean\`](../../data-types.md) | Flag Y/N - register the lead addition event ||
|#

## Code Examples

{% list tabs %}

- cURL (Webhook)

    \`\`\`bash
    curl -X POST https://example.bitrix24.com/rest/1/token/crm.lead.add
    \`\`\`

- JS

    \`\`\`js
    $b24.callMethod('crm.lead.add', { fields: { TITLE: 'A' } })
    \`\`\`

{% endlist %}

## Response Handling

### Returned Data

#|
|| **Name**
\`type\` | **Description** ||
|| **result**
[\`integer\`](../../data-types.md) | Identifier of the created lead ||
|#

## Error Handling

### Possible Errors

#|
|| **Code** | **Error Text** | **Description** ||
|| Empty Value | Access denied. | The user does not have permission to add a lead ||
|#
`

const TABS = `# Create a New CRM Item crm.item.add

> Scope: [\`crm\`](../../scopes/permissions.md)

Universal create.

## Method Parameters

#|
|| **Name**
\`type\` | **Description** ||
|| **entityTypeId***
[\`integer\`](../../data-types.md) | System or custom type identifier ||
|| **fields***
[\`object\`](../../data-types.md) | Field values ||
|#

### Parameter fields

{% list tabs %}

- Lead

  CRM object identifier **entityTypeId:** \`1\`

  #|
  || **Name**
  \`type\` | **Description** ||
  || **title**
  [\`string\`](../../data-types.md) | Item name. ||
  || **stageId**
  [\`crm_status\`](../data-types.md) | Stage identifier ||
  |#

- Deal

  CRM object identifier **entityTypeId:** \`2\`

  #|
  || **Name**
  \`type\` | **Description** ||
  || **title**
  [\`string\`](../../data-types.md) | Deal title ||
  || **categoryId**
  [\`integer\`](../../data-types.md) | Pipeline id ||
  |#

{% endlist %}
`

test('parseYfmTable splits Name/type rows', () => {
  const inner = firstYfmTableInner(FIXTURE)
  const rows = parseYfmTable(inner)
  const params = paramRowsFromTable(rows)
  assert.deepEqual(params.map(p => p.name), ['fields', 'params'])
  assert.equal(params[0].type, 'object')
})

test('parseMethodDoc extracts scope, deprecation, nested fields, errors', () => {
  const entry = parseMethodDoc({
    content: FIXTURE,
    path: 'docs/rest-api/api-reference/crm/leads/crm-lead-add.md',
  })
  assert.equal(entry.method, 'crm.lead.add')
  assert.equal(entry.kind, 'write')
  assert.deepEqual(entry.scopes, ['crm'])
  assert.equal(entry.deprecated, true)
  assert.equal(entry.replacedBy, 'crm.item.add')
  assert.match(entry.url, /apidocs\.bitrix24\.com\/api-reference\/crm\/leads\/crm-lead-add\.html/)
  const fields = entry.params.find(p => p.name === 'fields')
  assert.ok(fields.fields.some(f => f.name === 'TITLE'))
  const params = entry.params.find(p => p.name === 'params')
  assert.ok(params.fields.some(f => f.name === 'REGISTER_SONET_EVENT'))
  assert.equal(entry.returns[0].name, 'result')
  assert.equal(entry.errors[0].code, 'Empty Value')
  assert.ok(entry.examples.some(e => /webhook/i.test(e.title)))
})

test('formatCatalog default is labeled sections like the official MCP', () => {
  const text = formatCatalog(parseMethodDoc({
    content: FIXTURE,
    path: 'docs/rest-api/api-reference/crm/leads/crm-lead-add.md',
  }))
  assert.match(text, /^Method: crm\.lead\.add/m)
  assert.match(text, /Scope: crm/)
  assert.match(text, /Deprecated: yes — use crm\.item\.add/)
  assert.match(text, /TITLE/)
  assert.match(text, /confirm: true/)
  assert.match(text, /field: "markdown"/)
})

test('tabbed fields stay collapsed until filter matches a variant', () => {
  const entry = parseMethodDoc({
    content: TABS,
    path: 'docs/rest-api/api-reference/crm/universal/crm-item-add.md',
  })
  const fields = entry.params.find(p => p.name === 'fields')
  assert.ok(fields.variants?.some(v => v.title === 'Lead' && v.entityTypeId === '1'))
  const collapsed = formatCatalog(entry, { field: 'parameters' })
  assert.match(collapsed, /Variants: Lead \(entityTypeId 1\)/)
  assert.doesNotMatch(collapsed, /stageId/)
  const lead = formatCatalog(entry, { field: 'parameters', filter: 'Lead' })
  assert.match(lead, /stageId/)
  assert.match(lead, /entityTypeId 1/)
})

const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const leadDoc = join(hubRoot, 'docs/rest-api/api-reference/crm/leads/crm-lead-add.md')
const skip = existsSync(leadDoc) ? false : 'hub submodules not checked out'

test('real crm.lead.add doc catalogs TITLE and the crm.item.add replacement', { skip }, async () => {
  const content = await readFile(leadDoc, 'utf-8')
  const entry = parseMethodDoc({
    content,
    path: 'docs/rest-api/api-reference/crm/leads/crm-lead-add.md',
    method: 'crm.lead.add',
  })
  assert.equal(entry.method, 'crm.lead.add')
  assert.equal(entry.deprecated, true)
  const names = (entry.params.find(p => p.name === 'fields')?.fields || []).map(f => f.name)
  assert.ok(names.includes('TITLE'), names.slice(0, 8).join(', '))
  const text = formatCatalog(entry, { field: 'parameters' })
  assert.match(text, /fields/)
  assert.ok(text.length < 20_000)
})
