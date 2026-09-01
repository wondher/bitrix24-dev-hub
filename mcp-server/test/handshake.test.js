import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const MCP_INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js')

function sendLine(child, obj) {
  child.stdin.write(JSON.stringify(obj) + '\n')
}

/**
 * The MCP client (Cursor) sends `initialize` as soon as the process starts.
 * If we block on index build before listening on stdin, the handshake sits in
 * the pipe and the UI spinner never stops (Cursor times out at ~60s).
 *
 * B24_SLOW_INDEX_MS forces a 4s index delay so the race is deterministic.
 */
test('initialize is answered without waiting for the search index', async (t) => {
  const hub = await mkdtemp(join(tmpdir(), 'b24-handshake-'))
  t.after(() => rm(hub, { recursive: true, force: true }))
  await mkdir(join(hub, '.git'), { recursive: true })

  const child = spawn(process.execPath, [MCP_INDEX], {
    env: {
      ...process.env,
      B24_HUB_ROOT: hub,
      B24_SLOW_INDEX_MS: '4000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM')
  })

  let stdout = ''
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })

  const gotInit = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        `timed out waiting for initialize after 2.5s.\nstderr:\n${stderr}\nstdout:\n${stdout}`
      ))
    }, 2500)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id === 1 && msg.result?.protocolVersion) {
            clearTimeout(timer)
            resolve(msg)
            return
          }
        } catch { /* incomplete line */ }
      }
    })
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', (code, signal) => {
      if (code || signal) {
        clearTimeout(timer)
        reject(new Error(`server exited code=${code} signal=${signal}\nstderr:\n${stderr}`))
      }
    })
  })

  sendLine(child, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'handshake-test', version: '0.0.0' },
    },
  })

  const msg = await gotInit
  assert.equal(typeof msg.result.protocolVersion, 'string')
  assert.ok(
    !stderr.includes('Index ready') && !stderr.includes('Indexed '),
    `initialize must not wait for the index. stderr:\n${stderr}`
  )
})
