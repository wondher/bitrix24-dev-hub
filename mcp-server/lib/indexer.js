/**
 * Indexer — scans the hub submodule directories and builds a search index that
 * includes the full tokenized content (not just metadata), an inverted index
 * for fast term lookup, and document-length stats for BM25 ranking.
 *
 * Public API:
 *   - buildIndex(hubRoot)        : build a fresh index from disk
 *   - getOrBuildIndex(hubRoot)   : load persisted index if current, else build+save
 *   - searchIndex(index, query)  : run a query (delegates to search.rank)
 *   - getHubRoot()               : resolve and memoize the hub root
 *   - HUB_ROOT                   : resolved lazily via getHubRoot()
 */

import { readFile, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { glob } from 'glob'
import { tokenize, buildInvertedIndex, rank } from './search.js'
import {
  resolveHubRoot,
  loadIndex,
  saveIndex,
  computeManifest,
} from './store.js'

// Category → directory mappings based on hub layout.
const CATEGORY_MAP = {
  'sdks/php': { category: 'sdk', language: 'php' },
  'sdks/js': { category: 'sdk', language: 'js' },
  'sdks/python': { category: 'sdk', language: 'python' },
  'ui/components': { category: 'ui', language: 'vue' },
  'ui/style': { category: 'ui', language: 'css' },
  'ui/icons': { category: 'ui', language: 'svg' },
  'docs/rest-api': { category: 'api', language: 'markdown' },
  'examples/sdk-examples': { category: 'examples', language: 'mixed' },
  'examples/app-template-automation': { category: 'template', language: 'mixed' },
  'tools/crest': { category: 'tool', language: 'php' },
}

const INDEXABLE_EXTENSIONS = new Set([
  '.md', '.mdx',
  '.php', '.ts', '.tsx', '.js', '.jsx',
  '.vue', '.py',
  '.json',
  '.yaml', '.yml',
])

const SKIP_DIRS = new Set([
  'node_modules', 'vendor', '.git', '.nuxt', '.output', 'dist',
  '__pycache__', '.cache', 'coverage', '.turbo', '.b24-index',
])

let _hubRoot = null

/**
 * Resolve and memoize the hub root. Bootstraps the cache on first use.
 * @returns {Promise<string>}
 */
export async function getHubRoot() {
  if (_hubRoot) return _hubRoot
  _hubRoot = await resolveHubRoot()
  return _hubRoot
}

/** Drop the memo so tests can point B24_HUB_ROOT at a fixture. */
export function resetHubRoot() {
  _hubRoot = null
}

// Backwards-compat export: callers that import { HUB_ROOT } should await
// getHubRoot() instead. We expose the lazy resolver for code that needs the
// path synchronously after bootstrap.
export { getHubRoot as resolveHubRootSync }

/**
 * Extract a title from file content (first H1 or class/function declaration).
 */
function extractTitle(content, filePath) {
  const mdMatch = content.match(/^#\s+(.+)$/m)
  if (mdMatch) return mdMatch[1].trim()

  const phpClass = content.match(/(?:class|interface|trait|enum)\s+(\w+)/)
  if (phpClass) return phpClass[1]

  const tsExport = content.match(/export\s+(?:default\s+)?(?:class|function|interface|type|const|enum)\s+(\w+)/)
  if (tsExport) return tsExport[1]

  const vueName = content.match(/name:\s*['"](\w+)['"]/)
  if (vueName) return vueName[1]

  const pyDef = content.match(/(?:class|def)\s+(\w+)/)
  if (pyDef) return pyDef[1]

  return basename(filePath, extname(filePath))
}

/**
 * Extract a short display snippet from content (first meaningful paragraph).
 */
function extractSnippet(content, maxLen = 200) {
  const clean = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const lines = clean.split('\n').filter(l => l.trim().length > 10)
  const snippet = lines.slice(0, 3).join(' ').slice(0, maxLen)
  return snippet.length < clean.length ? snippet + '...' : snippet
}

/**
 * Decide whether a file is worth indexing.
 */
function shouldIndex(filePath) {
  const ext = extname(filePath)
  const base = basename(filePath)

  if (ext === '.md' || ext === '.mdx') return true

  // Skip test/spec files and directories. Match on path segments so that
  // "tests/...", "/tests/...", "foo.test.js" are all caught regardless of
  // whether the leading slash is present.
  const TEST_RE = /(^|\/)(tests?|__tests__|__mocks__)(\/|$)|\.(test|spec)\./i
  if (TEST_RE.test(filePath)) return false

  if (base.startsWith('.') && base !== '.env.example') return false
  if (['package-lock.json', 'composer.lock', 'yarn.lock', 'pnpm-lock.yaml'].includes(base)) return false

  if (['.php', '.ts', '.tsx', '.js', '.jsx', '.vue', '.py'].includes(ext)) return true

  if (ext === '.json' && ['package.json', 'composer.json', 'tsconfig.json'].includes(base)) return false

  return INDEXABLE_EXTENSIONS.has(ext)
}

/**
 * Build a fresh index from disk, tokenizing full content per file.
 *
 * @param {string} [hubRootOverride] Optional explicit hub root.
 * @returns {Promise<object>} The built index object.
 */
export async function buildIndex(hubRootOverride) {
  const hubRoot = hubRootOverride || await getHubRoot()
  const entries = []
  const stats = { total: 0, byCategory: {} }

  for (const [dir, meta] of Object.entries(CATEGORY_MAP)) {
    const fullPath = join(hubRoot, dir)
    let dirExists
    try {
      dirExists = (await stat(fullPath)).isDirectory()
    } catch {
      continue
    }
    if (!dirExists) continue

    const files = await glob('**/*', {
      cwd: fullPath,
      nodir: true,
      ignore: [...SKIP_DIRS].map(d => `**/${d}/**`),
    })

    for (const file of files) {
      if (!shouldIndex(file)) continue

      const absPath = join(fullPath, file)
      try {
        const content = await readFile(absPath, 'utf-8')
        if (content.length === 0) continue

        const id = entries.length
        entries.push({
          id,
          path: join(dir, file),     // relative to hub root
          title: extractTitle(content, file),
          category: meta.category,
          language: meta.language,
          snippet: extractSnippet(content),
          size: content.length,
          // Full content is tokenized here; only the token list is kept in
          // memory (not the raw content) to bound memory usage.
          tokens: tokenize(content),
        })

        stats.total++
        stats.byCategory[meta.category] = (stats.byCategory[meta.category] || 0) + 1
      } catch {
        // Skip unreadable files
      }
    }
  }

  const { inverted, docLengths, avgDocLength } = buildInvertedIndex(entries)

  // The token lists are only needed during index construction; drop them to
  // keep the persisted index compact.
  for (const entry of entries) delete entry.tokens

  return {
    stats,
    entries,
    inverted,
    docLengths,
    avgDocLength,
  }
}

/**
 * Load a persisted index if its manifest is current, otherwise build fresh and
 * save. This is what the server should call on startup for a fast boot.
 *
 * @param {string} [hubRootOverride]
 * @param {object} [options]
 * @param {boolean} [options.forceRebuild=false]
 * @returns {Promise<object>}
 */
export async function getOrBuildIndex(hubRootOverride, options = {}) {
  const { forceRebuild = false } = options
  const hubRoot = hubRootOverride || await getHubRoot()

  // Test hook: handshake.test.js uses this to prove initialize is not blocked
  // by index construction. Not set in production.
  const slowMs = Number(process.env.B24_SLOW_INDEX_MS || 0)
  if (slowMs > 0) {
    await new Promise(resolve => setTimeout(resolve, slowMs))
  }

  if (!forceRebuild) {
    const cached = await loadIndex(hubRoot)
    if (cached) {
      console.error(`[b24-dev-hub] Loaded cached index (${cached.entries.length} files)`)
      return cached
    }

    const stale = await loadIndex(hubRoot, { allowStale: true })
    if (stale) {
      console.error(
        `[b24-dev-hub] Serving stale index (${stale.entries.length} files) while rebuilding`
      )
      buildAndSave(hubRoot).catch(e => {
        console.error(`[b24-dev-hub] Background reindex failed: ${e.message}`)
      })
      return stale
    }
  }

  return buildAndSave(hubRoot)
}

async function buildAndSave(hubRoot) {
  console.error('[b24-dev-hub] Building search index (full scan)...')
  const index = await buildIndex(hubRoot)
  const manifest = await computeManifest(hubRoot)
  await saveIndex(hubRoot, index, manifest).catch(e => {
    console.error(`[b24-dev-hub] Warning: could not persist index: ${e.message}`)
  })
  console.error(
    `[b24-dev-hub] Indexed ${index.stats.total} files ` +
    `(${Object.entries(index.stats.byCategory).map(([k, v]) => `${k}: ${v}`).join(', ')})`
  )
  return index
}

/**
 * Run a search query against an index (thin wrapper around search.rank).
 */
export function searchIndex(index, query, options = {}) {
  return rank(query, index, options)
}
