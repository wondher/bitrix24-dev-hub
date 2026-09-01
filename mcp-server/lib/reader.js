/**
 * File reader utilities for the MCP server.
 * Reads files from the hub submodules and extracts relevant content.
 *
 * Hub root is resolved lazily via indexer.getHubRoot() so it works whether the
 * server is running from source or from the npx bootstrap cache.
 */

import { readFile, stat, readdir } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { glob } from 'glob'
import { getHubRoot } from './indexer.js'
import { tokenize } from './search.js'

// ─────────────────────────────────────────────────────────────
// In-process LRU cache for grep results.
// Keyed by (directory, pattern, dirMtime). Invalidated on reindex via clearCache().
// ─────────────────────────────────────────────────────────────

const GREP_CACHE_MAX = 64
const grepCache = new Map()

export function clearCache() {
  grepCache.clear()
}

function cacheGet(key) {
  if (!grepCache.has(key)) return undefined
  // Refresh recency by re-inserting (LRU).
  const value = grepCache.get(key)
  grepCache.delete(key)
  grepCache.set(key, value)
  return value
}

function cacheSet(key, value) {
  if (grepCache.size >= GREP_CACHE_MAX) {
    const oldest = grepCache.keys().next().value
    grepCache.delete(oldest)
  }
  grepCache.set(key, value)
}

/**
 * Read a file from the hub and return its content
 */
export async function readFileContent(relativePath) {
  const hubRoot = await getHubRoot()
  const absPath = join(hubRoot, relativePath)
  const content = await readFile(absPath, 'utf-8')
  return content
}

/**
 * Read a file and return structured info
 */
export async function readFileDetails(relativePath) {
  const hubRoot = await getHubRoot()
  const absPath = join(hubRoot, relativePath)
  const content = await readFile(absPath, 'utf-8')
  const ext = extname(relativePath)

  return {
    path: relativePath,
    language: extToLanguage(ext),
    size: content.length,
    content,
  }
}

/**
 * Search files by content using simple text matching, with an in-process cache
 * keyed on (directory, pattern, directory mtime) so repeated greps are free
 * within the lifetime of the server process.
 */
export async function searchFiles(dirRelative, pattern, options = {}) {
  const { maxResults = 20, filePattern = '**/*', beforeContext = 2, afterContext = 2 } = options
  const hubRoot = await getHubRoot()
  const fullDir = join(hubRoot, dirRelative)

  // Cache key includes the directory mtime so edits invalidate naturally.
  let dirMtime = 0
  try { dirMtime = (await stat(fullDir)).mtimeMs } catch { /* dir may not exist yet */ }
  const cacheKey = `${dirRelative}\u0000${pattern}\u0000${dirMtime}\u0000${maxResults}`
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const files = await glob(filePattern, {
    cwd: fullDir,
    nodir: true,
    ignore: ['**/node_modules/**', '**/vendor/**', '**/.git/**', '**/dist/**'],
  })

  const results = []
  const lowerPattern = pattern.toLowerCase()
  const queryTerms = new Set(tokenize(pattern))

  for (const file of files) {
    if (results.length >= maxResults) break

    try {
      const absPath = join(fullDir, file)
      const content = await readFile(absPath, 'utf-8')
      const lines = content.split('\n')
      const matches = []

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerPattern)) {
          const start = Math.max(0, i - beforeContext)
          const end = Math.min(lines.length, i + afterContext + 1)
          matches.push({
            line: i + 1,
            context: lines.slice(start, end).join('\n'),
          })
        }
      }

      if (matches.length > 0) {
        results.push({
          path: join(dirRelative, file),
          matches,
        })
      }
    } catch {
      // Skip unreadable files
    }
  }

  // When the pattern tokenizes into query terms, rank files by how many of
  // those terms appear in the path/filename — brings the most relevant files
  // to the top instead of relying on glob's arbitrary ordering.
  if (queryTerms.size > 0) {
    results.sort((a, b) => {
      const aPath = tokenize(a.path)
      const bPath = tokenize(b.path)
      const aHits = aPath.filter(t => queryTerms.has(t)).length
      const bHits = bPath.filter(t => queryTerms.has(t)).length
      return bHits - aHits
    })
  }

  cacheSet(cacheKey, results)
  return results
}

/**
 * Find the best-matching API method documentation in b24restdocs.
 *
 * Ranking: exact filename match > normalized filename match > content relevance
 * scored by query-term overlap. Returns the single best candidate.
 */
export async function findApiMethod(methodName) {
  const hubRoot = await getHubRoot()
  const normalizedMethod = methodName.toLowerCase().replace(/\./g, '-')
  const restApiDir = join(hubRoot, 'docs/rest-api')

  const files = await glob('api-reference/**/*.md', { cwd: restApiDir, nodir: true })

  // Exact match first.
  let match = files.find(f => basename(f, '.md') === normalizedMethod)
  let matchKind = 'exact'

  // Normalized partial match.
  if (!match) {
    match = files.find(f => basename(f, '.md').includes(normalizedMethod))
    matchKind = 'partial'
  }

  // Content relevance: rank candidates by query-term overlap rather than
  // returning the first file that merely contains the string.
  if (!match) {
    const terms = new Set(tokenize(methodName))
    let best = null
    let bestScore = 0
    for (const file of files) {
      try {
        const content = await readFile(join(restApiDir, file), 'utf-8')
        const contentTokens = new Set(tokenize(content))
        let score = 0
        for (const t of terms) if (contentTokens.has(t)) score++
        if (content.toLowerCase().includes(methodName.toLowerCase())) score += 2
        if (score > bestScore) { bestScore = score; best = file }
      } catch { /* skip */ }
    }
    if (best && bestScore > 0) { match = best; matchKind = 'content' }
  }

  if (!match) return null

  const content = await readFile(join(restApiDir, match), 'utf-8')
  return {
    path: `docs/rest-api/${match}`,
    method: methodName,
    content,
    matchKind,
  }
}

/**
 * Find API event documentation in b24restdocs.
 */
export async function findApiEvent(eventName) {
  const hubRoot = await getHubRoot()
  const restApiDir = join(hubRoot, 'docs/rest-api')

  const eventFiles = await glob('api-reference/**/events/**/*.md', { cwd: restApiDir, nodir: true })
  const allFiles = eventFiles.length > 0
    ? eventFiles
    : await glob('api-reference/**/*.md', { cwd: restApiDir, nodir: true })

  const normalizedEvent = eventName.toLowerCase()
  const terms = new Set(tokenize(eventName))

  let best = null
  let bestScore = 0

  for (const file of allFiles) {
    try {
      const content = await readFile(join(restApiDir, file), 'utf-8')
      const contentLower = content.toLowerCase()
      let score = 0
      if (contentLower.includes(normalizedEvent)) score += 5
      const contentTokens = new Set(tokenize(content))
      for (const t of terms) if (contentTokens.has(t)) score++
      // Prefer files in an events/ directory.
      if (file.includes('/events/')) score += 1
      if (score > bestScore) { bestScore = score; best = file }
    } catch { /* skip */ }
  }

  if (!best || bestScore === 0) return null

  const content = await readFile(join(restApiDir, best), 'utf-8')
  return {
    path: `docs/rest-api/${best}`,
    event: eventName,
    content,
  }
}

/**
 * Find the best-matching SDK class/method in source code.
 */
export async function findSdkReference(name, sdk) {
  const hubRoot = await getHubRoot()
  const sdkDir = sdk === 'php' ? 'sdks/php/src'
    : sdk === 'js' ? 'sdks/js/packages'
    : 'sdks/python'

  const fullDir = join(hubRoot, sdkDir)
  const lowerName = name.toLowerCase()

  const extensions = sdk === 'php' ? '*.php'
    : sdk === 'js' ? '*.{ts,tsx,js}'
    : '*.py'

  const files = await glob(`**/${extensions}`, {
    cwd: fullDir,
    nodir: true,
    ignore: ['**/node_modules/**', '**/vendor/**', '**/test*/**', '**/__tests__/**'],
  })

  // Filename match: exact basename (sans extension) beats substring; among
  // substring hits, prefer the shallower path so `client.py` wins over nested
  // `booking/.../client.py`.
  const stem = (f) => basename(f, extname(f)).toLowerCase()
  const byDepth = (a, b) => a.split('/').length - b.split('/').length || a.length - b.length
  let match = files.find(f => stem(f) === lowerName)
  if (!match) {
    const partials = files.filter(f => stem(f).includes(lowerName) || basename(f).toLowerCase().includes(lowerName))
    if (partials.length) match = [...partials].sort(byDepth)[0]
  }
  let matchKind = match ? 'filename' : null

  // Content relevance ranking.
  if (!match) {
    const terms = new Set(tokenize(name))
    const decl = new RegExp(
      `(?:export\\s+)?(?:default\\s+)?(?:class|function|interface|type|const|def)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
    )
    let best = null
    let bestScore = 0
    for (const file of files) {
      try {
        const content = await readFile(join(fullDir, file), 'utf-8')
        const contentTokens = new Set(tokenize(content))
        let score = 0
        for (const t of terms) if (contentTokens.has(t)) score++
        if (content.toLowerCase().includes(lowerName)) score += 2
        if (decl.test(content)) score += 20
        score -= file.split('/').length
        if (score > bestScore) { bestScore = score; best = file }
      } catch { /* skip */ }
    }
    if (best && bestScore > 0) { match = best; matchKind = 'content' }
  }

  if (!match) return null

  const content = await readFile(join(fullDir, match), 'utf-8')
  return {
    path: `${sdkDir}/${match}`,
    name,
    sdk,
    content,
    matchKind,
  }
}

/**
 * Find the best-matching UI component by name.
 */
export async function findUiComponent(componentName) {
  const hubRoot = await getHubRoot()
  const uiDir = join(hubRoot, 'ui/components')
  const lowerName = componentName.toLowerCase()

  const files = await glob('src/runtime/components/**/*.vue', {
    cwd: uiDir,
    nodir: true,
  })

  // Exact filename first (Button.vue before ButtonGroup.vue).
  const baseOf = (f) => basename(f, '.vue').toLowerCase()
  let match = files.find(f => baseOf(f) === lowerName || baseOf(f) === `b24-${lowerName}`)
  if (!match) {
    match = files.find(f => baseOf(f).includes(lowerName))
  }
  let matchKind = match ? 'filename' : null

  // Content relevance ranking.
  if (!match) {
    const terms = new Set(tokenize(componentName))
    let best = null
    let bestScore = 0
    for (const file of files) {
      try {
        const content = await readFile(join(uiDir, file), 'utf-8')
        const contentTokens = new Set(tokenize(content))
        let score = 0
        for (const t of terms) if (contentTokens.has(t)) score++
        if (content.toLowerCase().includes(lowerName)) score += 2
        if (score > bestScore) { bestScore = score; best = file }
      } catch { /* skip */ }
    }
    if (best && bestScore > 0) { match = best; matchKind = 'content' }
  }

  if (!match) return null

  const content = await readFile(join(uiDir, match), 'utf-8')

  // Also try to find docs for this component.
  const docFiles = await glob('docs/content/docs/**/*.md', { cwd: uiDir, nodir: true })
  let docContent = null
  const docMatch = docFiles.find(f => {
    const base = basename(f, '.md').toLowerCase()
    return base === lowerName || base.includes(lowerName)
  })
  if (docMatch) {
    docContent = await readFile(join(uiDir, docMatch), 'utf-8')
  }

  return {
    path: `ui/components/${match}`,
    name: componentName,
    content,
    docsPath: docMatch ? `ui/components/${docMatch}` : null,
    docs: docContent,
    matchKind,
  }
}

/**
 * Example roots: PHP/JS live under examples/sdk-examples/{lang}/.
 * Python snippets live under sdks/python/examples/ (there is no python/ folder
 * in sdk-examples).
 */
async function exampleRoots(hubRoot, language) {
  const roots = []
  if (language === 'all' || language === 'php' || language === 'js') {
    const base = join(hubRoot, 'examples/sdk-examples')
    const langs = language === 'all'
      ? (await readdir(base).catch(() => [])).filter(l => l !== 'python')
      : [language]
    for (const lang of langs) {
      roots.push({
        abs: join(base, lang),
        rel: `examples/sdk-examples/${lang}`,
        language: lang,
      })
    }
  }
  if (language === 'all' || language === 'python') {
    roots.push({
      abs: join(hubRoot, 'sdks/python/examples'),
      rel: 'sdks/python/examples',
      language: 'python',
    })
  }
  return roots
}

/**
 * Find code examples, ranked by query-term relevance.
 */
export async function findExamples(topic, language = 'all') {
  const hubRoot = await getHubRoot()
  const terms = new Set(tokenize(topic))
  const lowerTopic = topic.toLowerCase()
  const roots = await exampleRoots(hubRoot, language)
  const scored = []

  for (const root of roots) {
    try {
      if (!(await stat(root.abs)).isDirectory()) continue

      const files = await glob('**/*.{md,php,ts,js,py,vue}', {
        cwd: root.abs,
        nodir: true,
        ignore: ['**/node_modules/**'],
      })

      for (const file of files) {
        try {
          const content = await readFile(join(root.abs, file), 'utf-8')
          const contentTokens = new Set(tokenize(content))
          let score = 0
          for (const t of terms) if (contentTokens.has(t)) score++
          if (content.toLowerCase().includes(lowerTopic)) score += 2
          const pathTokens = new Set(tokenize(`${root.language}/${file}`))
          for (const t of terms) if (pathTokens.has(t)) score += 3
          if (score > 0) {
            scored.push({
              path: `${root.rel}/${file}`,
              language: root.language,
              content: content.length > 5000 ? content.slice(0, 5000) + '\n... (truncated)' : content,
              score,
            })
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 15)
}

/**
 * List resources by category
 */
export async function listResources(category, filter = '') {
  const hubRoot = await getHubRoot()
  const lowerFilter = filter.toLowerCase()

  switch (category) {
    case 'api-methods': {
      const dir = join(hubRoot, 'docs/rest-api')
      const files = await glob('api-reference/**/*.md', { cwd: dir, nodir: true })
      return files
        .map(f => basename(f, '.md'))
        .filter(n => !lowerFilter || n.includes(lowerFilter))
        .sort()
    }

    case 'api-events': {
      const dir = join(hubRoot, 'docs/rest-api')
      const files = await glob('api-reference/**/events/**/*.md', { cwd: dir, nodir: true })
      return files
        .map(f => basename(f, '.md'))
        .filter(n => !lowerFilter || n.includes(lowerFilter))
        .sort()
    }

    case 'sdk-services': {
      const items = []

      const phpDir = join(hubRoot, 'sdks/php/src/Services')
      for (const name of await readdir(phpDir).catch(() => [])) {
        try {
          if (!(await stat(join(phpDir, name))).isDirectory()) continue
          items.push(`php/${name}`)
        } catch { /* skip */ }
      }

      const pyDir = join(hubRoot, 'sdks/python/b24pysdk/scopes')
      for (const name of await readdir(pyDir).catch(() => [])) {
        if (name.startsWith('_')) continue
        items.push(`python/${name.replace(/\.py$/, '')}`)
      }

      const jsDir = join(hubRoot, 'sdks/js/packages/jssdk/src')
      for (const name of await readdir(jsDir).catch(() => [])) {
        if (name === 'types' || name === 'index.ts' || name === 'index.js') continue
        try {
          if (!(await stat(join(jsDir, name))).isDirectory()) continue
          items.push(`js/${name}`)
        } catch { /* skip */ }
      }

      return items
        .filter(n => !lowerFilter || n.toLowerCase().includes(lowerFilter))
        .sort()
    }

    case 'ui-components': {
      const uiDir = join(hubRoot, 'ui/components')
      const files = await glob('src/runtime/components/**/*.vue', { cwd: uiDir, nodir: true })
      return files
        .map(f => basename(f, '.vue'))
        .filter(n => !lowerFilter || n.toLowerCase().includes(lowerFilter))
        .sort()
    }

    case 'examples': {
      const all = []
      const exDir = join(hubRoot, 'examples/sdk-examples')
      const langs = await readdir(exDir).catch(() => [])
      for (const lang of langs) {
        try {
          const langDir = join(exDir, lang)
          if (!(await stat(langDir)).isDirectory()) continue
          const dirs = await readdir(langDir).catch(() => [])
          all.push(...dirs
            .filter(d => !lowerFilter || d.toLowerCase().includes(lowerFilter))
            .map(d => `${lang}/${d}`))
        } catch { /* skip */ }
      }
      const pyScopes = join(hubRoot, 'sdks/python/examples/scopes')
      for (const d of await readdir(pyScopes).catch(() => [])) {
        try {
          if (!(await stat(join(pyScopes, d))).isDirectory()) continue
          const label = `python/${d}`
          if (!lowerFilter || label.toLowerCase().includes(lowerFilter) || d.toLowerCase().includes(lowerFilter)) {
            all.push(label)
          }
        } catch { /* skip */ }
      }
      return all.sort()
    }

    case 'sdk-scopes': {
      const scopeFile = join(hubRoot, 'docs/rest-api/api-reference/scopes/permissions.md')
      const markdown = await readFile(scopeFile, 'utf-8').catch(() => '')
      return parseScopeCodes(markdown)
        .filter(code => !lowerFilter || code.toLowerCase().includes(lowerFilter))
        .sort()
    }

    default:
      return []
  }
}

/**
 * Parse Bitrix24 REST scope codes from the permissions.md table.
 * Rows look like `|| **crm** | …` or `|| **sonet_group, socialnetwork** | …`.
 */
export function parseScopeCodes(markdown) {
  const codes = []
  const seen = new Set()
  const rowRe = /^\|\|\s*\*\*([^*]+)\*\*/gm
  for (const match of markdown.matchAll(rowRe)) {
    const raw = match[1].trim()
    if (/^scope code$/i.test(raw)) continue
    for (const part of raw.split(',')) {
      const code = part.trim()
      if (!code || seen.has(code)) continue
      seen.add(code)
      codes.push(code)
    }
  }
  return codes
}

// Helper
function extToLanguage(ext) {
  const map = {
    '.md': 'markdown', '.mdx': 'markdown',
    '.php': 'php',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.vue': 'vue',
    '.py': 'python',
    '.json': 'json',
    '.yaml': 'yaml', '.yml': 'yaml',
  }
  return map[ext] || 'text'
}
