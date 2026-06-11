/**
 * File reader utilities for the MCP server.
 * Reads files from the hub submodules and extracts relevant content.
 */

import { readFile, stat, readdir } from 'node:fs/promises'
import { join, extname, basename, dirname } from 'node:path'
import { glob } from 'glob'
import { HUB_ROOT } from './indexer.js'

/**
 * Read a file from the hub and return its content
 */
export async function readFileContent(relativePath) {
  const absPath = join(HUB_ROOT, relativePath)
  const content = await readFile(absPath, 'utf-8')
  return content
}

/**
 * Read a file and return structured info
 */
export async function readFileDetails(relativePath) {
  const absPath = join(HUB_ROOT, relativePath)
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
 * Search files by content using simple text matching
 */
export async function searchFiles(dirRelative, pattern, options = {}) {
  const { maxResults = 20, filePattern = '**/*', beforeContext = 2, afterContext = 2 } = options
  const fullDir = join(HUB_ROOT, dirRelative)

  const files = await glob(filePattern, {
    cwd: fullDir,
    nodir: true,
    ignore: ['**/node_modules/**', '**/vendor/**', '**/.git/**', '**/dist/**'],
  })

  const results = []
  const lowerPattern = pattern.toLowerCase()

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

  return results
}

/**
 * Find API method documentation in b24restdocs
 */
export async function findApiMethod(methodName) {
  const normalizedMethod = methodName.toLowerCase().replace(/\./g, '-')
  const restApiDir = join(HUB_ROOT, 'docs/rest-api')

  // Search in api-reference directory
  const files = await glob('api-reference/**/*.md', { cwd: restApiDir, nodir: true })

  // Try exact match first
  let match = files.find(f => basename(f, '.md') === normalizedMethod)

  // Try partial match
  if (!match) {
    match = files.find(f => basename(f, '.md').includes(normalizedMethod))
  }

  // Try searching by method name in content
  if (!match) {
    for (const file of files) {
      try {
        const content = await readFile(join(restApiDir, file), 'utf-8')
        if (content.toLowerCase().includes(methodName.toLowerCase())) {
          match = file
          break
        }
      } catch { /* skip */ }
    }
  }

  if (!match) return null

  const content = await readFile(join(restApiDir, match), 'utf-8')
  return {
    path: `docs/rest-api/${match}`,
    method: methodName,
    content,
  }
}

/**
 * Find API event documentation in b24restdocs
 */
export async function findApiEvent(eventName) {
  const restApiDir = join(HUB_ROOT, 'docs/rest-api')
  const normalizedEvent = eventName.toLowerCase()

  const files = await glob('api-reference/**/events/**/*.md', { cwd: restApiDir, nodir: true })

  // Also search all files for the event name
  const allFiles = files.length > 0 ? files : await glob('api-reference/**/*.md', { cwd: restApiDir, nodir: true })

  for (const file of allFiles) {
    try {
      const content = await readFile(join(restApiDir, file), 'utf-8')
      if (content.toLowerCase().includes(normalizedEvent)) {
        return {
          path: `docs/rest-api/${file}`,
          event: eventName,
          content,
        }
      }
    } catch { /* skip */ }
  }

  return null
}

/**
 * Find SDK class/method in source code
 */
export async function findSdkReference(name, sdk) {
  const sdkDir = sdk === 'php' ? 'sdks/php/src'
    : sdk === 'js' ? 'sdks/js/packages'
    : 'sdks/python'

  const fullDir = join(HUB_ROOT, sdkDir)
  const lowerName = name.toLowerCase()

  const extensions = sdk === 'php' ? '*.php'
    : sdk === 'js' ? '*.{ts,tsx,js}'
    : '*.py'

  const files = await glob(`**/${extensions}`, {
    cwd: fullDir,
    nodir: true,
    ignore: ['**/node_modules/**', '**/vendor/**', '**/test*/**', '**/__tests__/**'],
  })

  // Try filename match first
  let match = files.find(f => basename(f).toLowerCase().includes(lowerName))

  // Search content
  if (!match) {
    for (const file of files) {
      try {
        const content = await readFile(join(fullDir, file), 'utf-8')
        if (content.toLowerCase().includes(lowerName)) {
          match = file
          break
        }
      } catch { /* skip */ }
    }
  }

  if (!match) return null

  const content = await readFile(join(fullDir, match), 'utf-8')
  return {
    path: `${sdkDir}/${match}`,
    name,
    sdk,
    content,
  }
}

/**
 * Find UI component by name
 */
export async function findUiComponent(componentName) {
  const uiDir = join(HUB_ROOT, 'ui/components')
  const lowerName = componentName.toLowerCase()

  // Search in runtime/components
  const files = await glob('src/runtime/components/**/*.vue', {
    cwd: uiDir,
    nodir: true,
  })

  // Try exact filename match
  let match = files.find(f => {
    const base = basename(f, '.vue').toLowerCase()
    return base === lowerName || base === `b24-${lowerName}` || base.includes(lowerName)
  })

  // Search content for component name
  if (!match) {
    for (const file of files) {
      try {
        const content = await readFile(join(uiDir, file), 'utf-8')
        if (content.toLowerCase().includes(lowerName)) {
          match = file
          break
        }
      } catch { /* skip */ }
    }
  }

  if (!match) return null

  const content = await readFile(join(uiDir, match), 'utf-8')

  // Also try to find docs for this component
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
  }
}

/**
 * Find code examples
 */
export async function findExamples(topic, language = 'all') {
  const examplesDir = join(HUB_ROOT, 'examples/sdk-examples')
  const lowerTopic = topic.toLowerCase()

  const langDirs = language === 'all'
    ? await readdir(examplesDir).catch(() => [])
    : [language]

  const results = []

  for (const lang of langDirs) {
    try {
      const langDir = join(examplesDir, lang)
      if (!(await stat(langDir)).isDirectory()) continue

      const files = await glob('**/*.{md,php,ts,js,py,vue}', {
        cwd: langDir,
        nodir: true,
        ignore: ['**/node_modules/**'],
      })

      for (const file of files) {
        try {
          const content = await readFile(join(langDir, file), 'utf-8')
          if (content.toLowerCase().includes(lowerTopic)) {
            results.push({
              path: `examples/sdk-examples/${lang}/${file}`,
              language: lang,
              content: content.length > 5000 ? content.slice(0, 5000) + '\n... (truncated)' : content,
            })
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return results.slice(0, 15)
}

/**
 * List resources by category
 */
export async function listResources(category, filter = '') {
  const lowerFilter = filter.toLowerCase()

  switch (category) {
    case 'api-methods': {
      const dir = join(HUB_ROOT, 'docs/rest-api')
      const files = await glob('api-reference/**/*.md', { cwd: dir, nodir: true })
      return files
        .map(f => basename(f, '.md'))
        .filter(n => !lowerFilter || n.includes(lowerFilter))
        .sort()
    }

    case 'api-events': {
      const dir = join(HUB_ROOT, 'docs/rest-api')
      const files = await glob('api-reference/**/events/**/*.md', { cwd: dir, nodir: true })
      return files
        .map(f => basename(f, '.md'))
        .filter(n => !lowerFilter || n.includes(lowerFilter))
        .sort()
    }

    case 'sdk-services': {
      const phpDir = join(HUB_ROOT, 'sdks/php/src/Services')
      const dirs = await readdir(phpDir).catch(() => [])
      return dirs.filter(d => !lowerFilter || d.toLowerCase().includes(lowerFilter)).sort()
    }

    case 'ui-components': {
      const uiDir = join(HUB_ROOT, 'ui/components')
      const files = await glob('src/runtime/components/**/*.vue', { cwd: uiDir, nodir: true })
      return files
        .map(f => basename(f, '.vue'))
        .filter(n => !lowerFilter || n.toLowerCase().includes(lowerFilter))
        .sort()
    }

    case 'examples': {
      const exDir = join(HUB_ROOT, 'examples/sdk-examples')
      const langs = await readdir(exDir).catch(() => [])
      const all = []
      for (const lang of langs) {
        try {
          const langDir = join(exDir, lang)
          if (!(await stat(langDir)).isDirectory()) continue
          const dirs = await readdir(langDir).catch(() => [])
          all.push(...dirs.filter(d => !lowerFilter || d.toLowerCase().includes(lowerFilter)).map(d => `${lang}/${d}`))
        } catch { /* skip */ }
      }
      return all.sort()
    }

    case 'sdk-scopes': {
      const scopeDir = join(HUB_ROOT, 'docs/rest-api/scopes')
      const files = await glob('*.md', { cwd: scopeDir, nodir: true }).catch(() => [])
      return files.map(f => basename(f, '.md')).sort()
    }

    default:
      return []
  }
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
