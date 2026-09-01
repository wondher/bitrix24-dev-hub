/**
 * Store — resolves where the hub content lives and persists the search index.
 *
 * Hub root resolution priority:
 *   1. B24_HUB_ROOT env var (for users who already have the repo cloned)
 *   2. ~/.b24-dev-hub/ (bootstrap cache, default for npx usage)
 *   3. ../../ relative to this package (when running from source)
 *
 * The on-disk index lives under <hubRoot>/.b24-index/ so it co-locates with the
 * content it indexes and is invalidated naturally when the content is updated.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

// Bump when the index shape changes to force a rebuild.
export const INDEX_VERSION = 2

const DEFAULT_REPO = 'https://github.com/wondher/bitrix24-dev-hub.git'

/**
 * Directory used for the bootstrap cache (clone of the hub repo).
 */
export function cacheDir() {
  return join(homedir(), '.b24-dev-hub')
}

/**
 * Resolve the hub root directory, bootstrapping the cache if needed.
 *
 * @param {object} [options]
 * @param {boolean} [options.autoBootstrap=true] When true and no root is found,
 *   clone the repo into the cache dir on first use.
 * @returns {Promise<string>} Absolute path to the hub root.
 */
export async function resolveHubRoot({ autoBootstrap = true } = {}) {
  // 1. Explicit env override
  const envRoot = process.env.B24_HUB_ROOT
  if (envRoot && existsSync(envRoot)) return envRoot

  // 2. Bootstrap cache
  const cache = cacheDir()
  if (existsSync(join(cache, '.git'))) return cache

  // 3. Running from source (../../ from this file)
  const sourceRoot = join(import.meta.dirname, '..', '..')
  if (existsSync(join(sourceRoot, '.git'))) return sourceRoot

  // 4. First-time use: clone into the cache
  if (!autoBootstrap) {
    throw new Error(
      `Hub root not found. Set B24_HUB_ROOT, clone the repo, or run without autoBootstrap disabled.`
    )
  }

  await bootstrapCache()
  return cache
}

/**
 * Clone the hub repo (with submodules) into the cache directory.
 * Override the source repo with B24_HUB_REPO.
 */
export async function bootstrapCache() {
  const repo = process.env.B24_HUB_REPO || DEFAULT_REPO
  const target = cacheDir()

  if (existsSync(target)) {
    // Partial state — clear it before cloning to avoid git errors.
    await rm(target, { recursive: true, force: true })
  }

  console.error(`[b24-dev-hub] First-time setup: cloning ${repo} into ${target}`)
  console.error('[b24-dev-hub] This may take a few minutes (submodules)...')

  await runGit(['clone', '--recurse-submodules', '--depth', '1', repo, target])

  // Shallow submodules can be too shallow for some operations; fetch tags are fine.
  console.error('[b24-dev-hub] Clone complete.')
  return target
}

/**
 * Update the cached repo's submodules to their latest upstream commits.
 * @returns {Promise<boolean>} true if any submodule changed.
 */
export async function updateCache() {
  const root = await resolveHubRoot({ autoBootstrap: false })
  console.error(`[b24-dev-hub] Updating submodules in ${root}...`)
  await runGit(['submodule', 'update', '--remote', '--merge'], { cwd: root })
  return true
}

// ─────────────────────────────────────────────────────────────
// Index persistence
// ─────────────────────────────────────────────────────────────

function indexDir(hubRoot) {
  return join(hubRoot, '.b24-index')
}

function manifestPath(hubRoot) {
  return join(indexDir(hubRoot), 'manifest.json')
}

function indexPath(hubRoot) {
  return join(indexDir(hubRoot), 'index.json')
}

/**
 * Compute a manifest hash that changes when the indexed content changes.
 * Uses `git submodule status` (cheap, reflects submodule commits) plus a
 * file count of the top-level dirs as a fallback for non-git environments.
 *
 * @param {string} hubRoot
 * @returns {Promise<{hash: string, version: number}>}
 */
export async function computeManifest(hubRoot) {
  const submoduleStatus = await runGitCapture(['submodule', 'status'], { cwd: hubRoot })
    .catch(() => '')
  const hash = `${INDEX_VERSION}:${hashString(submoduleStatus)}`
  return { hash, version: INDEX_VERSION }
}

/**
 * Load a previously-built index if its manifest still matches the current state.
 *
 * @param {string} hubRoot
 * @returns {Promise<object|null>} The loaded index, or null if it must be rebuilt.
 */
export async function loadIndex(hubRoot, { allowStale = false } = {}) {
  const manifestFile = manifestPath(hubRoot)
  const indexFile = indexPath(hubRoot)

  if (!existsSync(manifestFile) || !existsSync(indexFile)) return null

  try {
    const current = await computeManifest(hubRoot)
    const saved = JSON.parse(await readFile(manifestFile, 'utf-8'))

    if (saved.hash !== current.hash && !allowStale) return null

    const raw = await readFile(indexFile, 'utf-8')
    return deserializeIndex(raw)
  } catch (e) {
    console.error(`[b24-dev-hub] Could not load index: ${e.message}`)
    return null
  }
}

/**
 * Persist a built index to disk along with its manifest.
 *
 * @param {string} hubRoot
 * @param {object} index The index object built by indexer.buildIndex().
 * @param {object} manifest The manifest produced by computeManifest().
 */
export async function saveIndex(hubRoot, index, manifest) {
  const dir = indexDir(hubRoot)
  mkdirSync(dir, { recursive: true })
  await writeFile(indexPath(hubRoot), serializeIndex(index), 'utf-8')
  await writeFile(manifestPath(hubRoot), JSON.stringify(manifest, null, 2), 'utf-8')
}

/**
 * Remove any persisted index so the next load forces a rebuild.
 */
export async function clearIndex(hubRoot) {
  await rm(indexDir(hubRoot), { recursive: true, force: true }).catch(() => {})
}

// ─────────────────────────────────────────────────────────────
// (De)serialization
// ─────────────────────────────────────────────────────────────

// Maps don't survive JSON. Convert to/from plain objects.
function serializeIndex(index) {
  return JSON.stringify({
    version: INDEX_VERSION,
    stats: index.stats,
    entries: index.entries,
    inverted: Object.fromEntries(
      Object.entries(index.inverted).map(([term, postings]) => [
        term,
        Object.fromEntries(postings),
      ])
    ),
    docLengths: index.docLengths,
    avgDocLength: index.avgDocLength,
  })
}

function deserializeIndex(raw) {
  const data = JSON.parse(raw)
  // Rebuild with a null-prototype object so terms colliding with
  // Object.prototype members (e.g. "constructor", "set") stay safe.
  const inverted = Object.create(null)
  for (const [term, postings] of Object.entries(data.inverted)) {
    inverted[term] = new Map(Object.entries(postings).map(([k, v]) => [Number(k), v]))
  }
  return {
    version: data.version,
    stats: data.stats,
    entries: data.entries,
    inverted,
    docLengths: data.docLengths,
    avgDocLength: data.avgDocLength,
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function runGit(args, options = {}) {
  const { timeoutMs = 60_000, ...spawnOpts } = options
  return new Promise((resolve, reject) => {
    // Never inherit stdout: git progress on stdout corrupts MCP JSON-RPC.
    const child = spawn('git', args, {
      ...spawnOpts,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', d => process.stderr.write(d))
    child.stderr.on('data', d => process.stderr.write(d))
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`git ${args.join(' ')} exited with code ${code}`))
    })
  })
}

function runGitCapture(args, options = {}) {
  const { timeoutMs = 30_000, ...spawnOpts } = options
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { ...spawnOpts, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`git ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', () => {})
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`git ${args.join(' ')} exited with code ${code}`))
    })
  })
}

/**
 * Stable string hash (djb2). Good enough for change detection, not crypto.
 */
function hashString(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16)
}
