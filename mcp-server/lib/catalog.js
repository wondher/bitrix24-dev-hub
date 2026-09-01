/**
 * Structured REST method catalog parsed from Bitrix24 YFM docs.
 *
 * Official b24-dev-mcp returns labeled sections (Method, Scope, Parameters,
 * Returns, Errors, Examples) instead of raw markdown. This module does the
 * same from the local hub so agents stop inventing field names.
 */

import { classifyB24Method } from './liveguard.js'

const APIDOCS = 'https://apidocs.bitrix24.com'

/**
 * @param {string} markdown
 * @returns {string}
 */
export function stripNestedYfmTables(markdown) {
  let out = String(markdown || '')
  while (out.includes('#|')) {
    const start = out.indexOf('#|')
    let depth = 1
    let j = start + 2
    while (j < out.length && depth > 0) {
      if (out.startsWith('#|', j)) {
        depth++
        j += 2
      } else if (out.startsWith('|#', j)) {
        depth--
        j += 2
      } else {
        j++
      }
    }
    out = `${out.slice(0, start)} ${out.slice(j)}`
  }
  return out
}

/**
 * First (outer) YFM table inner body in `md`, or null.
 * @param {string} md
 */
export function firstYfmTableInner(md) {
  const source = String(md || '')
  const start = source.indexOf('#|')
  if (start === -1) return null
  let depth = 1
  let j = start + 2
  while (j < source.length && depth > 0) {
    if (source.startsWith('#|', j)) {
      depth++
      j += 2
    } else if (source.startsWith('|#', j)) {
      depth--
      j += 2
    } else {
      j++
    }
  }
  if (depth !== 0) return null
  return source.slice(start + 2, j - 2)
}

/**
 * Split a YFM table body into rows of cells.
 * @param {string} inner
 * @returns {string[][]}
 */
export function parseYfmTable(inner) {
  const stripped = stripNestedYfmTables(inner)
  const rows = []
  const re = /\|\|([\s\S]*?)\|\|/g
  let match
  while ((match = re.exec(stripped))) {
    const raw = match[1]
    if (!raw.trim()) continue
    rows.push(raw.split(/\s\|\s/).map(c => c.trim()))
  }
  return rows
}

function compactText(value, max = 220) {
  let text = String(value || '')
    .replace(/\{%\s*[\s\S]*?%\}/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return `${sp > 40 ? cut.slice(0, sp) : cut}…`
}

function parseNameType(cell) {
  const nameMatch = String(cell || '').match(/\*\*([A-Za-z0-9_.[\]]+(?:\.\.\.)?)\*\*(\*)?/)
  if (!nameMatch) return null
  const typeMatch = String(cell || '').match(/\[`([^`]+)`\]|`([A-Za-z0-9_[\]|]+)`/)
  return {
    name: nameMatch[1],
    required: Boolean(nameMatch[2]),
    type: (typeMatch?.[1] || typeMatch?.[2] || '').trim(),
  }
}

const HEADER_NAMES = new Set(['name', 'code', 'type', 'error text', 'description'])

/**
 * @param {string[][]} rows
 */
export function paramRowsFromTable(rows) {
  const params = []
  for (const cells of rows) {
    const parsed = parseNameType(cells[0] || '')
    if (!parsed) continue
    if (HEADER_NAMES.has(parsed.name.toLowerCase())) continue
    params.push({
      name: parsed.name,
      type: parsed.type,
      required: parsed.required,
      description: compactText(cells.slice(1).join(' | ')),
    })
  }
  return params
}

function errorRowsFromTable(rows) {
  const errors = []
  for (const cells of rows) {
    const first = compactText(cells[0] || '', 80)
    if (!first || /^(code|\*\*code\*\*)$/i.test(first)) continue
    if (HEADER_NAMES.has(first.toLowerCase())) continue
    errors.push({
      code: first.replace(/\*\*/g, ''),
      message: compactText(cells[1] || '', 160),
      description: compactText(cells[2] || '', 220),
    })
  }
  return errors
}

function headingSection(markdown, heading) {
  const source = String(markdown || '')
  const re = new RegExp(`^#{2,3}\\s+${heading}\\b.*$`, 'im')
  const match = re.exec(source)
  if (!match) return ''
  const start = match.index
  const rest = source.slice(start + match[0].length)
  const next = rest.search(/\n#{2,3}\s+/)
  return source.slice(start, next === -1 ? source.length : start + match[0].length + next)
}

function methodFromTitle(markdown, filePath = '') {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1] || ''
  const dotted = [...h1.matchAll(/\b([a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){1,})\b/g)]
  if (dotted.length) return dotted[dotted.length - 1][1]
  const base = String(filePath).split('/').pop() || ''
  return base.replace(/\.md$/, '').replace(/-/g, '.')
}

function scopesFrom(markdown) {
  const line = markdown.match(/^>\s*Scope:\s*(.+)$/im)?.[1] || ''
  const codes = [...line.matchAll(/\[`([^`]+)`\]/g)].map(m => m[1])
  return [...new Set(codes)]
}

function docsUrlFromPath(path) {
  const rel = String(path || '').replace(/^docs\/rest-api\//, '').replace(/\.md$/, '.html')
  if (!rel || rel === path) return ''
  return `${APIDOCS}/${rel}`
}

function moduleFromPath(path) {
  const parts = String(path || '').split('/')
  const idx = parts.indexOf('api-reference')
  if (idx === -1 || !parts[idx + 1]) return ''
  return parts[idx + 1]
}

function parseTabs(section) {
  const match = String(section || '').match(/\{%\s*list tabs\s*%\}([\s\S]*?)\{%\s*endlist\s*%\}/)
  if (!match) return []
  const chunks = match[1].split(/^(?=- )/m).filter(c => c.trim().startsWith('- '))
  const variants = []
  for (const chunk of chunks) {
    const title = chunk.match(/^- (.+)$/m)?.[1]?.trim()
    if (!title || /cURL|JS SDK|PHP|Python|CRest|BX24|Webhook|OAuth/i.test(title)) continue
    const entityTypeId = chunk.match(/entityTypeId:?[*\s]*`?(\d+)`?/i)?.[1] || ''
    const inner = firstYfmTableInner(chunk)
    const fields = inner ? paramRowsFromTable(parseYfmTable(inner)) : []
    variants.push({ title, entityTypeId, fields })
  }
  return variants
}

function attachParameterSubtables(markdown, params) {
  const re = /^### Parameter (\w+)\b.*$/gim
  let match
  while ((match = re.exec(markdown))) {
    const name = match[1]
    const section = headingSection(markdown, `Parameter ${name}`)
    if (!section) continue
    const variants = parseTabs(section)
    const inner = firstYfmTableInner(section)
    const fields = inner ? paramRowsFromTable(parseYfmTable(inner)) : []
    if (!fields.length && !variants.length) continue
    let target = params.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (!target) {
      target = { name, type: 'object', required: false, description: '' }
      params.push(target)
    }
    if (variants.length) target.variants = variants
    else if (fields.length) target.fields = fields
  }
}

function firstParagraph(markdown) {
  const stripped = String(markdown || '')
    .replace(/\{%\s*note[\s\S]*?\{%\s*endnote\s*%\}/gi, '\n')
    .replace(/^>.*$/gm, '')
    .replace(/\{%[\s\S]*?%\}/g, '')
  for (const block of stripped.split(/\n{2,}/)) {
    const line = block.replace(/^#+\s+/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('```')) continue
    if (/^(Scope:|Who can execute)/i.test(line)) continue
    return compactText(line, 400)
  }
  return ''
}

function extractExamples(section, filter = '') {
  const out = []
  const re = /(?:^|\n)-\s+([^\n]+)\n[\s\S]*?```(\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = re.exec(section))) {
    const title = match[1].trim()
    if (/note on/i.test(title)) continue
    out.push({
      title,
      language: (match[2] || '').toLowerCase(),
      code: match[3].trim().slice(0, 1800),
    })
  }
  const needle = String(filter || '').toLowerCase()
  if (needle) {
    const hit = out.filter(e =>
      e.title.toLowerCase().includes(needle) || e.language.includes(needle)
    )
    if (hit.length) return hit.slice(0, 2)
  }
  const webhook = out.filter(e => /webhook/i.test(e.title))
  return (webhook.length ? webhook : out).slice(0, 1)
}

function replacedBy(markdown) {
  const match = markdown.match(/Please use \[([^\]]+)\]\(([^)]+)\)/i)
  if (!match) return ''
  const label = match[1].trim()
  if (/^[a-z][a-z0-9.]+$/.test(label)) return label
  const file = match[2].split('/').pop() || ''
  return file.replace(/\.md$/, '').replace(/-/g, '.')
}

/**
 * @param {{ content: string, path?: string, method?: string }} args
 */
export function parseMethodDoc({ content, path = '', method = '' }) {
  const markdown = String(content || '')
  const name = methodFromTitle(markdown, path) || String(method || '').trim()
  const paramSection = headingSection(markdown, 'Method Parameters')
  const returnsSection = headingSection(markdown, 'Returned Data')
  const errorsSection = headingSection(markdown, 'Possible Errors')
  const examplesSection = headingSection(markdown, 'Code Examples')

  const paramInner = firstYfmTableInner(paramSection)
  const params = paramInner ? paramRowsFromTable(parseYfmTable(paramInner)) : []
  attachParameterSubtables(markdown, params)

  const returnInner = firstYfmTableInner(returnsSection)
  const returns = returnInner ? paramRowsFromTable(parseYfmTable(returnInner)) : []

  const errorInner = firstYfmTableInner(errorsSection)
  const errors = errorInner ? errorRowsFromTable(parseYfmTable(errorInner)) : []

  const deprecated = /DEPRECATED/i.test(markdown.slice(0, 2500))
  const who = compactText(
    markdown.match(/^>\s*Who can execute the method:\s*(.+)$/im)?.[1] || '',
    180,
  )

  return {
    method: name,
    kind: classifyB24Method(name),
    rest: 'v1',
    module: moduleFromPath(path),
    scopes: scopesFrom(markdown),
    who,
    deprecated,
    replacedBy: deprecated ? replacedBy(markdown) : '',
    description: firstParagraph(markdown),
    url: docsUrlFromPath(path),
    path,
    params,
    returns,
    errors,
    examples: extractExamples(examplesSection),
  }
}

function formatParam(param, indent = 0) {
  const pad = '  '.repeat(indent)
  const req = param.required ? ' [required]' : ''
  const type = param.type ? `(${param.type}) ` : ''
  const desc = param.description ? ` ${param.description}` : ''
  const lines = [`${pad}- ${param.name}: ${type}${desc.trim()}${req}`.trimEnd()]
  if (Array.isArray(param.fields)) {
    for (const child of param.fields) lines.push(...formatParam(child, indent + 1))
  }
  if (Array.isArray(param.variants) && param.variants.length) {
    const names = param.variants.map(v =>
      v.entityTypeId ? `${v.title} (entityTypeId ${v.entityTypeId})` : v.title
    )
    lines.push(`${pad}  Variants: ${names.join(', ')}. Pass filter=<variant> to list those fields.`)
  }
  return lines
}

function formatParamFiltered(param, filter) {
  const needle = filter.toLowerCase()
  if (param.name.toLowerCase().includes(needle)) return formatParam(param)
  const variant = (param.variants || []).find(v =>
    v.title.toLowerCase().includes(needle)
    || String(v.entityTypeId) === filter
  )
  if (!variant) return []
  const head = formatParam({ ...param, variants: undefined, fields: undefined })
  head.push(`  ${variant.title}${variant.entityTypeId ? ` (entityTypeId ${variant.entityTypeId})` : ''}:`)
  for (const child of variant.fields || []) head.push(...formatParam(child, 2))
  return head
}

/**
 * @param {ReturnType<typeof parseMethodDoc>} entry
 * @param {{ field?: string, filter?: string }} [opts]
 */
export function formatCatalog(entry, { field = 'all', filter = '' } = {}) {
  if (!entry?.method) return ''
  const want = String(field || 'all').toLowerCase()
  const lines = [
    `Method: ${entry.method}`,
    `Kind: ${entry.kind}`,
    `REST: ${entry.rest}`,
  ]
  if (entry.module) lines.push(`Module: ${entry.module}`)
  if (entry.scopes.length) lines.push(`Scope: ${entry.scopes.join(', ')}`)
  if (entry.who) lines.push(`Who: ${entry.who}`)
  if (entry.deprecated) {
    lines.push(`Deprecated: yes${entry.replacedBy ? ` — use ${entry.replacedBy}` : ''}`)
  }
  if (entry.description) lines.push(`Description: ${entry.description}`)
  if (entry.url) lines.push(`URL: ${entry.url}`)
  if (entry.path) lines.push(`Path: ${entry.path}`)

  const includeParams = want === 'all' || want === 'parameters'
  const includeReturns = want === 'all' || want === 'returns'
  const includeErrors = want === 'all' || want === 'errors'
  const includeExamples = want === 'all' || want === 'examples'

  if (includeParams) {
    lines.push('Parameters:')
    if (!entry.params.length) {
      lines.push('- (none listed in the local doc)')
    } else {
      for (const param of entry.params) {
        const chunk = filter
          ? formatParamFiltered(param, filter)
          : formatParam(param)
        if (chunk.length) lines.push(...chunk)
      }
      if (filter && lines.at(-1) === 'Parameters:') {
        lines.push(`- no parameter or variant matching "${filter}"`)
      }
    }
  }

  if (includeReturns) {
    lines.push('Returns:')
    if (!entry.returns.length) lines.push('- (see markdown for response shape)')
    else for (const item of entry.returns) lines.push(...formatParam(item))
  }

  if (includeErrors) {
    lines.push('Errors:')
    if (!entry.errors.length) lines.push('- (see markdown / system errors include)')
    else {
      for (const err of entry.errors) {
        const extra = err.description && err.description !== err.message
          ? ` — ${err.description}`
          : ''
        lines.push(`- ${err.code}: ${err.message}${extra}`)
      }
    }
  }

  if (includeExamples) {
    let list = entry.examples
    if (filter) {
      const needle = filter.toLowerCase()
      const hit = list.filter(e =>
        e.title.toLowerCase().includes(needle) || e.language.includes(needle)
      )
      if (hit.length) list = hit
    }
    lines.push('Examples:')
    if (!list.length) {
      lines.push('- (none extracted; pass field=markdown)')
    } else {
      for (const ex of list) {
        lines.push(`${ex.title}:`)
        lines.push(`\`\`\`${ex.language || ''}`.trimEnd())
        lines.push(ex.code)
        lines.push('```')
      }
    }
  }

  const confirm = entry.kind === 'write' ? ', confirm: true' : ''
  lines.push(
    `Live: b24_call({ method: "${entry.method}", params: {…}${confirm} })`,
  )
  if (want !== 'markdown') {
    lines.push(
      `Full markdown: b24hub_api_method({ method: "${entry.method}", field: "markdown" })`,
    )
  }
  return lines.join('\n')
}
