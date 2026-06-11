/**
 * Indexer — Scans all submodule directories and builds a lightweight search index.
 * Each entry has: path, title, category, language, snippet, lastModified
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, extname, basename, relative } from 'node:path'
import { glob } from 'glob'

const HUB_ROOT = join(import.meta.dirname, '..', '..')

// Category mappings based on directory
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

// Extensions to index
const INDEXABLE_EXTENSIONS = new Set([
  '.md', '.mdx',
  '.php', '.ts', '.tsx', '.js', '.jsx',
  '.vue', '.py',
  '.json', // package.json only
  '.yaml', '.yml',
])

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', '.git', '.nuxt', '.output', 'dist',
  '__pycache__', '.cache', 'coverage', '.turbo',
])

/**
 * Extract a title from file content (first H1 or class/function declaration)
 */
function extractTitle(content, filePath) {
  // Markdown: first # heading
  const mdMatch = content.match(/^#\s+(.+)$/m)
  if (mdMatch) return mdMatch[1].trim()

  // PHP: class name
  const phpClass = content.match(/(?:class|interface|trait|enum)\s+(\w+)/)
  if (phpClass) return phpClass[1]

  // TS/JS: export class/function/interface
  const tsExport = content.match(/export\s+(?:default\s+)?(?:class|function|interface|type|const|enum)\s+(\w+)/)
  if (tsExport) return tsExport[1]

  // Vue: component name from defineOptions or file name
  const vueName = content.match(/name:\s*['"](\w+)['"]/)
  if (vueName) return vueName[1]

  // Python: class or def
  const pyDef = content.match(/(?:class|def)\s+(\w+)/)
  if (pyDef) return pyDef[1]

  return basename(filePath, extname(filePath))
}

/**
 * Extract a short snippet from content
 */
function extractSnippet(content, maxLen = 200) {
  // Strip code blocks and HTML tags for snippet
  const clean = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Take first meaningful paragraph
  const lines = clean.split('\n').filter(l => l.trim().length > 10)
  const snippet = lines.slice(0, 3).join(' ').slice(0, maxLen)
  return snippet.length < clean.length ? snippet + '...' : snippet
}

/**
 * Detect if a file is worth indexing
 */
function shouldIndex(filePath) {
  const ext = extname(filePath)
  const base = basename(filePath)

  // Always index markdown
  if (ext === '.md' || ext === '.mdx') return true

  // Skip test files
  if (filePath.includes('/test') || filePath.includes('/tests') || filePath.includes('/__tests__') || filePath.includes('.test.') || filePath.includes('.spec.')) return false

  // Skip config/build files
  if (base.startsWith('.') && base !== '.env.example') return false
  if (['package-lock.json', 'composer.lock', 'yarn.lock', 'pnpm-lock.yaml'].includes(base)) return false

  // Index source code
  if (['.php', '.ts', '.tsx', '.js', '.jsx', '.vue', '.py'].includes(ext)) return true

  // Only index specific JSON files
  if (ext === '.json' && ['package.json', 'composer.json', 'tsconfig.json'].includes(base)) return false

  return INDEXABLE_EXTENSIONS.has(ext)
}

/**
 * Build the search index
 */
export async function buildIndex() {
  const entries = []
  const stats = { total: 0, byCategory: {} }

  for (const [dir, meta] of Object.entries(CATEGORY_MAP)) {
    const fullPath = join(HUB_ROOT, dir)
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

        const title = extractTitle(content, file)
        const snippet = extractSnippet(content)

        const entry = {
          path: join(dir, file),       // relative to hub root
          title,
          category: meta.category,
          language: meta.language,
          snippet,
          size: content.length,
        }

        entries.push(entry)
        stats.total++
        stats.byCategory[meta.category] = (stats.byCategory[meta.category] || 0) + 1
      } catch {
        // Skip unreadable files
      }
    }
  }

  return { entries, stats }
}

/**
 * Search the index
 */
export function searchIndex(index, query, options = {}) {
  const { scope = 'all', language = 'all', limit = 20 } = options
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  let results = index.entries

  // Filter by scope
  if (scope !== 'all') {
    results = results.filter(e => e.category === scope)
  }

  // Filter by language
  if (language !== 'all') {
    results = results.filter(e => e.language === language || e.language === 'mixed')
  }

  // Score and sort by relevance
  const scored = results.map(entry => {
    const titleLower = entry.title.toLowerCase()
    const pathLower = entry.path.toLowerCase()
    const snippetLower = entry.snippet.toLowerCase()

    let score = 0
    for (const term of terms) {
      // Title match (highest weight)
      if (titleLower.includes(term)) score += 10
      // Path/filename match
      if (pathLower.includes(term)) score += 5
      // Snippet match
      if (snippetLower.includes(term)) score += 2
    }

    // Bonus for exact title match
    if (terms.length === 1 && titleLower === terms[0]) score += 50

    // Bonus for short titles (likely more specific)
    if (entry.title.length < 30) score += 1

    return { ...entry, score }
  })

  return scored
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export { HUB_ROOT }
