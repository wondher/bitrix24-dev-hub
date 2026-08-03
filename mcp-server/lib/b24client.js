/**
 * b24client — make live REST calls to a configured Bitrix24 endpoint.
 *
 * Auth model (v1): inbound webhook only. The token lives in the URL path:
 *   https://{baseUrl}/rest/{userId}/{webhookToken}/{method}.json
 * No `auth` param is appended. This matches the convention used by CRest
 * (tools/crest/src/crest.php:93), the PHP SDK (sdks/php/.../ApiClient.php:185)
 * and the Python SDK (sdks/python/.../call_method.py:67).
 *
 * Configuration is read from a local JSON file (.b24.config.json) that is
 * gitignored — the token never reaches the repository. See
 * .b24.config.example.json at the repo root for the schema.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveHubRoot } from './store.js'

/** Request timeout for live calls. */
const REQUEST_TIMEOUT_MS = 20_000

/** Soft cap on the JSON payload rendered into the tool response (chars). */
const MAX_PAYLOAD_CHARS = 20_000

// Per-process config cache. Reset by tests via `__resetConfigCache`.
let _cachedConfig = null
let _cachedProfile = undefined

/**
 * Resolve the path to the endpoint config file.
 *
 * Priority:
 *   1. B24_CONFIG_PATH env var (absolute path to a custom config)
 *   2. <hubRoot>/.b24.config.json (co-located with the hub content)
 *
 * Returns `null` if no hub root can be resolved (e.g. running before the
 * bootstrap cache exists and autoBootstrap is disabled). The caller treats a
 * missing file as "not configured" rather than an error.
 *
 * @returns {Promise<string|null>} Absolute path, or null if unresolvable.
 */
export async function resolveConfigPath() {
  const envPath = process.env.B24_CONFIG_PATH
  if (envPath) return envPath

  let hubRoot
  try {
    hubRoot = await resolveHubRoot({ autoBootstrap: false })
  } catch {
    return null
  }
  if (!hubRoot) return null
  return join(hubRoot, '.b24.config.json')
}

/**
 * Read and validate the endpoint config, caching the result per process.
 *
 * Two JSON shapes are accepted:
 *   - flat:   { baseUrl, userId, webhookToken }
 *   - profiles: { profiles: { default: { ... }, prod: { ... } } }
 *
 * The active profile is `process.env.B24_PROFILE || 'default'`. Flat shape is
 * equivalent to a single implicit profile.
 *
 * @param {object} [options]
 * @param {string} [options.profile] Override the active profile.
 * @returns {Promise<object|null>} Validated normalized config, or null when the
 *   file does not exist (i.e. not configured yet).
 * @throws {Error} If the file exists but is unreadable / invalid / fails
 *   validation, with a message guiding the user to the example file.
 */
export async function loadEndpointConfig({ profile } = {}) {
  const activeProfile = profile ?? process.env.B24_PROFILE ?? 'default'

  if (_cachedConfig && _cachedProfile === activeProfile) return _cachedConfig

  const path = await resolveConfigPath()
  if (!path || !existsSync(path)) {
    _cachedConfig = null
    _cachedProfile = activeProfile
    return null
  }

  let raw
  try {
    raw = await readFile(path, 'utf-8')
  } catch (e) {
    throw new Error(`Could not read Bitrix24 endpoint config at ${path}: ${e.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(
      `Invalid JSON in Bitrix24 endpoint config (${path}): ${e.message}. ` +
      `See .b24.config.example.json for the schema.`
    )
  }

  const cfg = normalizeConfig(parsed, activeProfile)
  validateConfig(cfg, path)
  _cachedConfig = cfg
  _cachedProfile = activeProfile
  return cfg
}

/**
 * Reduce either accepted JSON shape to a single flat config object.
 * Exported for testing.
 */
export function normalizeConfig(parsed, profile = 'default') {
  if (parsed && typeof parsed === 'object' && parsed.profiles) {
    const entry = parsed.profiles[profile]
    if (!entry) {
      throw new Error(
        `Profile "${profile}" not found in .b24.config.json. ` +
        `Available: ${Object.keys(parsed.profiles).join(', ')}.`
      )
    }
    return { ...entry, profile }
  }
  return { ...parsed, profile }
}

/**
 * Validate a normalized config. Exported for testing.
 */
export function validateConfig(cfg, path = '.b24.config.json') {
  const { baseUrl, userId, webhookToken } = cfg ?? {}

  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) {
    throw new Error(
      `Invalid "baseUrl" in ${path}: must start with "https://" ` +
      `(got ${JSON.stringify(baseUrl)}). Webhook auth requires HTTPS.`
    )
  }
  if (!/^\d+$/.test(String(userId).trim())) {
    throw new Error(
      `Invalid "userId" in ${path}: must be a positive integer ` +
      `(got ${JSON.stringify(userId)}).`
    )
  }
  if (typeof webhookToken !== 'string' || webhookToken.trim() === '') {
    throw new Error(
      `Invalid "webhookToken" in ${path}: must be a non-empty string.`
    )
  }
  return cfg
}

/**
 * Build the full webhook URL for a REST method.
 *
 *   https://maxipas.bitrix24.com.br/rest/89/<token>/crm.item.list.json
 *
 * Exported for testing.
 *
 * @param {object} cfg Normalized config ({ baseUrl, userId, webhookToken }).
 * @param {string} method REST method in dot notation, e.g. "crm.item.list".
 * @returns {string}
 */
export function buildWebhookUrl(cfg, method) {
  const base = String(cfg.baseUrl).replace(/\/+$/, '')
  const cleanMethod = String(method).replace(/^\/+/, '').replace(/\.json$/i, '')
  return `${base}/rest/${cfg.userId}/${cfg.webhookToken}/${cleanMethod}.json`
}

/**
 * Execute a REST method against the configured Bitrix24 endpoint.
 *
 * Uses POST with a JSON body (the Bitrix24 REST convention for webhooks).
 * Pagination offset is passed through as `params.start`. On any failure —
 * non-2xx HTTP or an `error` block in the response body — an Error is thrown
 * carrying the status and response body for the caller to surface.
 *
 * @param {object} cfg Normalized config.
 * @param {string} method REST method, e.g. "crm.item.list".
 * @param {object} [params] Request parameters (merged with `start`).
 * @param {object} [options]
 * @param {number} [options.start] Pagination offset (Bitrix24 `start`).
 * @returns {Promise<object>} Parsed JSON response.
 */
export async function callB24Method(cfg, method, params = {}, { start } = {}) {
  const url = buildWebhookUrl(cfg, method)

  const body = { ...params }
  if (start !== undefined && start !== null) body.start = start

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
      : e?.message
    throw new Error(
      `Network error calling Bitrix24 method "${method}": ${reason}. ` +
      `Check baseUrl/Connectivity in your .b24.config.json.`
    )
  }

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    const err = new Error(
      `Bitrix24 method "${method}" returned non-JSON (HTTP ${res.status}). ` +
      `First 200 chars: ${text.slice(0, 200)}`
    )
    err.status = res.status
    err.body = text
    throw err
  }

  if (!res.ok) {
    const err = new Error(
      `Bitrix24 method "${method}" failed with HTTP ${res.status}.`
    )
    err.status = res.status
    err.response = json
    throw err
  }

  if (json && json.error) {
    const err = new Error(
      `Bitrix24 method "${method}" returned an error: ` +
      `${json.error}${json.error_description ? ` — ${json.error_description}` : ''}`
    )
    err.status = res.status
    err.response = json
    throw err
  }

  return json
}

/**
 * Format a successful Bitrix24 response as markdown text for the MCP tool.
 *
 * Detects the standard pagination envelope (`result.next` + `total`) and, when
 * present, hints at how to fetch the next page. The payload is truncated to
 * MAX_PAYLOAD_CHARS to protect the caller's context window.
 *
 * Exported for testing.
 *
 * @param {string} method The REST method that was called.
 * @param {object} result The parsed JSON response.
 * @param {number} [requestedStart] The `start` value used in the request.
 * @returns {string}
 */
export function formatB24Result(method, result, requestedStart = 0) {
  const lines = []
  lines.push(`✅ \`${method}\``)

  const total = typeof result?.total === 'number' ? result.total : undefined
  const next = typeof result?.next === 'number' ? result.next : undefined

  if (total !== undefined) {
    lines.push(`📊 Total: ${total}`)
  }
  if (next !== undefined) {
    lines.push(`📌 Next page: call again with \`start: ${next}\` ` +
      `(showing ${requestedStart}–${next - 1} of ${total !== undefined ? total : '?'})`)
  }

  lines.push('')
  lines.push('```json')

  const payload = JSON.stringify(result?.result ?? result, null, 2)
  if (payload.length <= MAX_PAYLOAD_CHARS) {
    lines.push(payload)
  } else {
    const head = payload.slice(0, MAX_PAYLOAD_CHARS)
    lines.push(head)
    lines.push(`\n…[truncated ${payload.length - MAX_PAYLOAD_CHARS} chars — ` +
      `refine your \`params.filter\` or use \`start\` to page through results]`)
  }
  lines.push('```')

  return lines.join('\n')
}

// Test-only hook: drop the per-process cache so unit tests can re-read files.
export function __resetConfigCache() {
  _cachedConfig = null
  _cachedProfile = undefined
}
