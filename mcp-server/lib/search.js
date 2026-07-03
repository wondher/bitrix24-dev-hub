import { basename, extname } from 'node:path'

/**
 * Search engine — tokenization, inverted index construction, and TF-IDF/BM25
 * ranking. Pure functions with no I/O, so it is trivial to unit test.
 *
 * The index shape consumed/produced here:
 *   {
 *     entries:     Array<{ id, path, title, category, language, snippet, size }>,
 *     inverted:    Map<term, Map<docId, termFrequency>>,
 *     docLengths:  number[]      // token count per doc, indexed by docId
 *     avgDocLength: number,
 *     stats:       { total, byCategory }
 *   }
 */

// Common English words that add noise to code/docs search.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'so', 'such',
  'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'to',
  'was', 'will', 'with', 'use', 'using', 'used', 'via', 'into', 'if',
])

/**
 * Tokenize text into normalized, stemmed terms.
 *
 * Splits identifiers across common boundaries so that `LeadService`,
 * `lead-service`, `lead_service` and `lead.service` all yield `lead` + `service`.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text) return []
  // Insert spaces at boundaries: camelCase, PascalCase, non-alphanumeric.
  // camelCase split MUST run before lowercasing, or there are no uppercase
  // letters left to match.
  const split = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')   // camelCase  -> camel case
    .replace(/[^a-zA-Z0-9]+/g, ' ')           // separators -> spaces
    .toLowerCase()
    .trim()
  if (!split) return []
  const tokens = split.split(/\s+/)
  const out = []
  for (const t of tokens) {
    if (t.length < 2) continue
    if (STOPWORDS.has(t)) continue
    out.push(stem(t))
  }
  return out
}

/**
 * Very light stemmer: collapses a few English suffixes. Deliberately simple —
 * good enough for recall on code identifiers and API docs without the weight
 * of a full Porter stemmer.
 */
export function stem(word) {
  if (word.length > 5 && word.endsWith('tions')) return word.slice(0, -3) // tions -> tion
  if (word.length > 5 && word.endsWith('tion')) return word.slice(0, -3) + 't'
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/**
 * Build the inverted index and document-length table from entries that already
 * carry their tokenized content.
 *
 * @param {Array<{id:number, tokens:string[], title:string, path:string, category:string, language:string, snippet:string, size:number}>} docsWithTokens
 * @returns {{inverted:Object<string,Map<number,number>>, docLengths:number[], avgDocLength:number}}
 */
export function buildInvertedIndex(docsWithTokens) {
  // Use a null-prototype object so terms like "constructor", "toString", or
  // "set" don't collide with Object.prototype members.
  /** @type {Record<string, Map<number, number>>} */
  const inverted = Object.create(null)
  const docLengths = new Array(docsWithTokens.length)
  let totalLength = 0

  for (const doc of docsWithTokens) {
    const tf = new Map()
    for (const term of doc.tokens) {
      tf.set(term, (tf.get(term) || 0) + 1)
    }
    docLengths[doc.id] = doc.tokens.length
    totalLength += doc.tokens.length

    for (const [term, freq] of tf) {
      if (!inverted[term]) inverted[term] = new Map()
      inverted[term].set(doc.id, freq)
    }
  }

  const avgDocLength = docsWithTokens.length ? totalLength / docsWithTokens.length : 0
  return { inverted, docLengths, avgDocLength }
}

// BM25 params. k1 controls term-frequency saturation, b controls length
// normalization. Standard defaults (k1=1.2, b=0.75) work well for prose+code.
const BM25_K1 = 1.2
const BM25_B = 0.75

/**
 * Compute a BM25-like score for each document matching the query, with bonus
 * multipliers for title matches preserved from the original heuristic.
 *
 * @param {string} query
 * @param {object} index { entries, inverted, docLengths, avgDocLength }
 * @param {object} [options]
 * @param {string} [options.scope='all']
 * @param {string} [options.language='all']
 * @param {number} [options.limit=20]
 * @returns {Array<object>} scored entries (highest first), each gaining `.score`.
 */
export function rank(query, index, options = {}) {
  const { scope = 'all', language = 'all', limit = 20 } = options
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const { entries, inverted, docLengths, avgDocLength } = index
  const n = entries.length

  // idf per query term: log(1 + (N - df + 0.5) / (df + 0.5) + 1)
  const idf = {}
  for (const term of terms) {
    const postings = inverted[term]
    const df = postings ? postings.size : 0
    idf[term] = Math.log(1 + (n - df + 0.5) / (df + 0.5) + 1)
  }

  /** @type {Map<number, number>} */
  const scores = new Map()

  for (const term of terms) {
    const postings = inverted[term]
    if (!postings) continue
    for (const [docId, tf] of postings) {
      const entry = entries[docId]
      // Scope/language filter — applied here so we still iterate postings (cheap).
      if (scope !== 'all' && entry.category !== scope) continue
      if (language !== 'all' && entry.language !== language && entry.language !== 'mixed') continue

      const dl = docLengths[docId] || avgDocLength || 1
      const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / (avgDocLength || 1)))
      const tfNorm = (tf * (BM25_K1 + 1)) / denom
      const contribution = idf[term] * tfNorm
      scores.set(docId, (scores.get(docId) || 0) + contribution)
    }
  }

  const uniqueTerms = [...new Set(terms)]
  const results = []
  for (const [docId, baseScore] of scores) {
    const entry = entries[docId]
    const titleTokens = new Set(tokenize(entry.title))
    const titleMatchCount = uniqueTerms.filter(t => titleTokens.has(t)).length

    let score = baseScore
    // Bonus multiplier: title contains a query term (preserves the old
    // heuristic that a title match is a strong relevance signal).
    if (titleMatchCount > 0) score *= 1 + 0.5 * titleMatchCount
    // Exact title match against a single-term query is an even stronger signal.
    if (uniqueTerms.length === 1 && titleTokens.size === 1 && [...titleTokens][0] === uniqueTerms[0]) {
      score *= 2
    }
    // Filename-exact bonus: when the query maps to a normalized filename
    // (e.g. "crm.lead.add" -> "crm-lead-add" -> terms crm,lead,add and a file
    // named crm-lead-add.md), that file is almost certainly the canonical doc.
    const fileBase = basename(entry.path, extname(entry.path)).toLowerCase()
    const normalizedQuery = uniqueTerms.join('-')
    if (fileBase === normalizedQuery || fileBase === query.toLowerCase().replace(/[^a-z0-9]+/g, '-')) {
      score *= 1.5
    }

    results.push({ ...entry, score })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

/**
 * Build a display snippet centered on the best query-term match in the content,
 * rather than always taking the first lines. Falls back to the stored snippet.
 *
 * @param {string} query
 * @param {string} content  Full file content.
 * @param {string} fallback Stored snippet to use when no match is found.
 * @param {number} [windowChars=200]
 * @returns {string}
 */
export function snippetFor(query, content, fallback, windowChars = 200) {
  if (!content) return fallback || ''
  const terms = tokenize(query)
  if (terms.length === 0) return fallback || truncate(content, windowChars)

  const lower = content.toLowerCase()
  let bestPos = -1
  for (const term of terms) {
    const pos = lower.indexOf(term)
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos
  }

  if (bestPos === -1) return fallback || truncate(content, windowChars)

  // Snap to a line boundary near the match for readability.
  const lineStart = content.lastIndexOf('\n', bestPos) + 1
  let end = bestPos + windowChars
  const nextNewline = content.indexOf('\n', end)
  if (nextNewline !== -1 && nextNewline - lineStart < windowChars * 2) end = nextNewline
  const snippet = content.slice(lineStart, Math.min(content.length, end)).trim()
  return snippet.length < content.length ? snippet + '…' : snippet
}

function truncate(str, max) {
  const clean = str.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}
