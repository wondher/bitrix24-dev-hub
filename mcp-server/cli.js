/**
 * CLI entry — handles subcommands for cache/index management.
 *
 *   b24-dev-hub            -> start the MCP server (handled in index.js)
 *   b24-dev-hub update     -> git submodule update + reindex
 *   b24-dev-hub reindex    -> force rebuild the search index
 *   b24-dev-hub index-info -> print index stats and location
 *   b24-dev-hub --help     -> usage
 */

import { resolveHubRoot, updateCache, clearIndex, loadIndex } from './lib/store.js'
import { buildIndex, getHubRoot } from './lib/indexer.js'
import { computeManifest, saveIndex } from './lib/store.js'

const HELP = `b24-dev-hub — Bitrix24 Developer Hub MCP server

Usage:
  b24-dev-hub              Start the MCP server on stdio
  b24-dev-hub update       Update hub submodules to latest and reindex
  b24-dev-hub reindex      Force a full rebuild of the search index
  b24-dev-hub index-info   Show index location, size, and file counts
  b24-dev-hub --help       Show this help

Environment:
  B24_HUB_ROOT   Use this directory as the hub root instead of resolving it
  B24_HUB_REPO   Git URL to clone on first run (default: wondher/bitrix24-dev-hub)
`

export async function runCli(argv) {
  const cmd = argv[2]

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP)
    process.exit(cmd ? 0 : 0)
  }

  switch (cmd) {
    case 'update':
      return cmdUpdate()
    case 'reindex':
      return cmdReindex()
    case 'index-info':
      return cmdIndexInfo()
    default:
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`)
      process.exit(1)
  }
}

async function cmdUpdate() {
  await updateCache()
  // After an update the manifest will have changed; force a rebuild.
  await cmdReindex()
  process.exit(0)
}

async function cmdReindex() {
  const hubRoot = await getHubRoot()
  process.stderr.write(`[b24-dev-hub] Rebuilding index in ${hubRoot}...\n`)
  await clearIndex(hubRoot)
  const index = await buildIndex(hubRoot)
  const manifest = await computeManifest(hubRoot)
  await saveIndex(hubRoot, index, manifest)
  process.stderr.write(
    `[b24-dev-hub] Done. Indexed ${index.stats.total} files ` +
    `(${Object.entries(index.stats.byCategory).map(([k, v]) => `${k}: ${v}`).join(', ')}).\n`
  )
  process.exit(0)
}

async function cmdIndexInfo() {
  const hubRoot = await resolveHubRoot({ autoBootstrap: false }).catch(() => null)
  if (!hubRoot) {
    process.stdout.write('No hub root found. Run `b24-dev-hub` once to bootstrap.\n')
    process.exit(0)
  }

  const cached = await loadIndex(hubRoot)
  if (!cached) {
    process.stdout.write(`Hub root: ${hubRoot}\nIndex: not built yet (run \`b24-dev-hub reindex\`)\n`)
    process.exit(0)
  }

  const { total, byCategory } = cached.stats
  const memMB = (JSON.stringify(cached).length / (1024 * 1024)).toFixed(2)
  const lines = [
    `Hub root:      ${hubRoot}`,
    `Total files:   ${total}`,
    ``,
    `By category:`,
    ...Object.entries(byCategory).map(([k, v]) => `  ${k.padEnd(12)} ${v}`),
    ``,
    `Index size:    ~${memMB} MB (serialized)`,
    `Index version: ${cached.version}`,
  ]
  process.stdout.write(lines.join('\n') + '\n')
  process.exit(0)
}
