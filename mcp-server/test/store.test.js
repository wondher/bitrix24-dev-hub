import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { INDEX_VERSION, computeManifest, loadIndex, saveIndex, clearIndex } from '../lib/store.js'

/**
 * Create an isolated temp dir masquerading as a hub root (with a .git dir so
 * manifest computation can try git, which it tolerates failing).
 */
async function makeTempHub() {
  const dir = await mkdtemp(join(tmpdir(), 'b24-test-'))
  await mkdir(join(dir, '.git'), { recursive: true })
  return dir
}

test('INDEX_VERSION is a positive integer', () => {
  assert.equal(typeof INDEX_VERSION, 'number')
  assert.ok(INDEX_VERSION > 0)
})

test('computeManifest returns a stable hash + version', async (t) => {
  const hub = await makeTempHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const m1 = await computeManifest(hub)
  const m2 = await computeManifest(hub)
  assert.equal(m1.version, INDEX_VERSION)
  assert.equal(m1.hash, m2.hash, 'hash is deterministic for unchanged state')
})

test('loadIndex returns null when no index exists', async (t) => {
  const hub = await makeTempHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const result = await loadIndex(hub)
  assert.equal(result, null)
})

test('saveIndex then loadIndex round-trips the index', async (t) => {
  const hub = await makeTempHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = {
    stats: { total: 1, byCategory: { api: 1 } },
    entries: [{ id: 0, path: 'foo.md', title: 'Foo', category: 'api', language: 'markdown', snippet: 'snip', size: 3 }],
    inverted: { foo: new Map([[0, 2]]) },
    docLengths: [3],
    avgDocLength: 3,
  }
  const manifest = await computeManifest(hub)

  await saveIndex(hub, index, manifest)
  const loaded = await loadIndex(hub)

  assert.ok(loaded, 'index should load after save')
  assert.equal(loaded.entries.length, 1)
  assert.equal(loaded.entries[0].title, 'Foo')
  assert.ok(loaded.inverted.foo instanceof Map, 'inverted index Maps are restored')
  assert.equal(loaded.inverted.foo.get(0), 2)
  assert.equal(loaded.avgDocLength, 3)
})

test('loadIndex returns null after clearIndex', async (t) => {
  const hub = await makeTempHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = {
    stats: { total: 1, byCategory: {} },
    entries: [{ id: 0, path: 'foo.md', title: 'Foo', category: 'api', language: 'markdown', snippet: '', size: 1 }],
    inverted: {},
    docLengths: [1],
    avgDocLength: 1,
  }
  const manifest = await computeManifest(hub)
  await saveIndex(hub, index, manifest)
  assert.ok(await loadIndex(hub))

  await clearIndex(hub)
  assert.equal(await loadIndex(hub), null, 'index should be gone after clear')
})

test('loadIndex({ allowStale: true }) returns an index whose manifest hash no longer matches', async (t) => {
  const hub = await makeTempHub()
  t.after(() => rm(hub, { recursive: true, force: true }))

  const index = {
    stats: { total: 1, byCategory: { api: 1 } },
    entries: [{ id: 0, path: 'foo.md', title: 'Foo', category: 'api', language: 'markdown', snippet: 'snip', size: 3 }],
    inverted: { foo: new Map([[0, 2]]) },
    docLengths: [3],
    avgDocLength: 3,
  }
  const manifest = await computeManifest(hub)
  await saveIndex(hub, index, manifest)

  await writeFile(
    join(hub, '.b24-index', 'manifest.json'),
    JSON.stringify({ hash: 'definitely-stale', version: INDEX_VERSION }, null, 2)
  )

  assert.equal(await loadIndex(hub), null, 'fresh load rejects a stale manifest')
  const stale = await loadIndex(hub, { allowStale: true })
  assert.ok(stale, 'allowStale should still deserialize the last build')
  assert.equal(stale.entries[0].title, 'Foo')
})
