/**
 * Classify Bitrix24 REST v1 methods as read vs write so b24_call cannot
 * mutate a portal unless the caller passed confirm: true.
 */

const WRITE_LAST = new Set([
  'add', 'update', 'delete',
  'set', 'unset',
  'bind', 'unbind',
  'register', 'unregister',
  'start', 'kill', 'terminate', 'complete',
  'delegate', 'upload', 'create',
  'install', 'uninstall', 'move', 'send',
])

/**
 * @param {string} method
 * @returns {'read' | 'write'}
 */
export function classifyB24Method(method) {
  const normalized = String(method || '')
    .trim()
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/\.json$/, '')
  if (!normalized) return 'read'
  if (normalized === 'batch') return 'write'
  const last = normalized.split('.').pop()
  return WRITE_LAST.has(last) ? 'write' : 'read'
}

/**
 * @param {string} method
 * @param {boolean} [confirm]
 * @returns {string|null} Refusal message, or null when the call may proceed.
 */
export function assertMutationAllowed(method, confirm) {
  if (classifyB24Method(method) !== 'write') return null
  if (confirm === true) return null
  return (
    `⛔ \`${method}\` would mutate the portal (classified as write).\n\n` +
    `Re-call with confirm: true only if the user asked to create, change, or delete.\n\n` +
    `Example: b24_call({ method: "${method}", params: {…}, confirm: true })`
  )
}
