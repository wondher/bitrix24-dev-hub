/**
 * Page long hub files so tool responses stay inside a usable context window.
 * The 80 KB hard cap in toolguard.js is a last-resort stall guard; this is the
 * default the agent actually sees.
 */

export const DEFAULT_PAGE_CHARS = 12_000

/**
 * Collect ATX headings (`#`–`###`) with character offsets for jump-via-offset.
 * @param {string} markdown
 * @returns {{ level: number, title: string, offset: number }[]}
 */
export function headingOutline(markdown) {
  if (typeof markdown !== 'string' || !markdown) return []
  const headings = []
  const re = /^(#{1,3})\s+(.+?)\s*$/gm
  for (const match of markdown.matchAll(re)) {
    headings.push({
      level: match[1].length,
      title: match[2].trim(),
      offset: match.index,
    })
  }
  return headings
}

/**
 * Slice `text` at a character offset.
 * @param {string} text
 * @param {{ offset?: number, limit?: number }} [opts]
 */
export function pageText(text, { offset = 0, limit = DEFAULT_PAGE_CHARS } = {}) {
  const source = typeof text === 'string' ? text : ''
  const total = source.length
  const start = Math.max(0, Number(offset) || 0)
  const size = Math.max(1, Number(limit) || DEFAULT_PAGE_CHARS)
  const slice = source.slice(start, start + size)
  const end = start + slice.length
  return {
    text: slice,
    total,
    offset: start,
    limit: size,
    nextOffset: end < total ? end : null,
  }
}

/**
 * Render a paged document: title, path, heading outline, page cursor, slice.
 * @param {{ title: string, path?: string, content: string, offset?: number, limit?: number }} args
 */
export function formatDocPage({ title, path, content, offset = 0, limit = DEFAULT_PAGE_CHARS }) {
  const page = pageText(content, { offset, limit })
  const outline = headingOutline(content)
  const lines = [title]
  if (path) lines.push(`📁 ${path}`)
  if (outline.length) {
    lines.push('📑 Outline (use offset to jump to a heading):')
    for (const h of outline) {
      lines.push(`${'  '.repeat(Math.max(0, h.level - 1))}- ${h.title} (@${h.offset})`)
    }
  }
  const cursor = `📄 chars ${page.offset}–${page.offset + page.text.length} of ${page.total}`
  lines.push(
    page.nextOffset != null
      ? `${cursor}. Next page: offset=${page.nextOffset}`
      : cursor,
  )
  lines.push('', page.text)
  return lines.join('\n')
}
