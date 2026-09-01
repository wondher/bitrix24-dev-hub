/**
 * Guards around MCP tool handlers: every call must finish, and payloads must
 * stay small enough that the stdio JSON-RPC write cannot stall the client.
 */

export const TOOL_TIMEOUT_MS = 25_000
export const MAX_TOOL_CHARS = 80_000

/**
 * Truncate a string and append a note with the number of dropped characters.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function capText(text, max = MAX_TOOL_CHARS) {
  if (typeof text !== 'string' || text.length <= max) return text
  return `${text.slice(0, max)}\n\n…[truncated ${text.length - max} chars]`
}

/**
 * Apply capText to every text part of an MCP CallTool result.
 * @param {object} result
 * @param {number} [max]
 * @returns {object}
 */
export function capResult(result, max = MAX_TOOL_CHARS) {
  if (!result?.content || !Array.isArray(result.content)) return result
  return {
    ...result,
    content: result.content.map(part => {
      if (part?.type === 'text' && typeof part.text === 'string') {
        return { ...part, text: capText(part.text, max) }
      }
      return part
    }),
  }
}

/**
 * Wrap a tool handler so it always resolves: timeout or throw become `{ isError: true }`.
 * @param {Function} handler
 * @param {number} [ms]
 * @param {string} [name]
 * @returns {Function}
 */
export function withTimeout(handler, ms = TOOL_TIMEOUT_MS, name = 'tool') {
  return async (...args) => {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${name} timed out after ${ms}ms`)),
        ms
      )
    })
    try {
      const result = await Promise.race([Promise.resolve(handler(...args)), timeout])
      return capResult(result)
    } catch (e) {
      return {
        content: [{ type: 'text', text: `❌ ${name} failed: ${e.message}` }],
        isError: true,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
