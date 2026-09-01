#!/usr/bin/env node

/**
 * b24-dev-hub — MCP Server for the Bitrix24 Developer Hub
 *
 * Provides intelligent search and retrieval across all Bitrix24 development
 * resources: SDKs (PHP, JS, Python), UI components, REST API docs,
 * code examples, app templates, and tools.
 *
 * Runs over stdio. On first use it clones its content cache into
 * ~/.b24-dev-hub/ so `npx b24-dev-hub` works on any machine.
 *
 * Subcommands (update / reindex / index-info) are handled by ./cli.js.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getOrBuildIndex, searchIndex } from './lib/indexer.js'
import {
  findApiMethod,
  findApiEvent,
  findSdkReference,
  findUiComponent,
  findExamples,
  listResources,
  readFileContent,
  searchFiles,
} from './lib/reader.js'
import {
  loadEndpointConfig,
  callB24Method,
  formatB24Result,
} from './lib/b24client.js'
import { withTimeout } from './lib/toolguard.js'
import { formatDocPage, DEFAULT_PAGE_CHARS } from './lib/paginate.js'
import { assertMutationAllowed } from './lib/liveguard.js'
import { buildPrompt, methodResourceUri } from './lib/surface.js'
import { parseMethodDoc, formatCatalog } from './lib/catalog.js'
import { runCli } from './cli.js'

const pageFields = {
  offset: z.number().int().min(0).default(0)
    .describe('Character offset into the document. Use the Next page offset from a previous response.'),
  limit: z.number().int().min(500).max(80_000).default(DEFAULT_PAGE_CHARS)
    .describe(`Maximum characters to return (default ${DEFAULT_PAGE_CHARS}).`),
}

// ─────────────────────────────────────────────────────────────
// Subcommand dispatch: anything other than starting the server.
// ─────────────────────────────────────────────────────────────

const SUBCOMMANDS = new Set(['update', 'reindex', 'index-info', '--help', '-h', 'help'])
const firstArg = process.argv[2]

if (firstArg && SUBCOMMANDS.has(firstArg)) {
  await runCli(process.argv)
}

// ─────────────────────────────────────────────────────────────
// Bootstrap: build (or load) the search index.
// ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'b24-dev-hub',
  version: '1.0.0',
})

console.error('[b24-dev-hub] Starting up...')

// Build the search index in the background. Cursor sends `initialize` as soon
// as the process starts; awaiting the index here leaves stdin unread and the
// client spinner never stops (createClient times out at ~60s).
const indexPromise = getOrBuildIndex()
async function getIndex() {
  return indexPromise
}

const addTool = server.tool.bind(server)
function registerTool(name, description, schema, handler) {
  addTool(name, description, schema, withTimeout(handler, 25_000, name))
}

// ─────────────────────────────────────────────────────────────
// Tool 1: b24hub_search — Universal search across all repos
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_search',
  `Search across all Bitrix24 development resources (SDKs, UI components, REST API docs, examples, templates). ` +
  `Returns matching files ranked by relevance (BM25 over the full file contents — not just titles) with snippets. ` +
  `Use this to discover what's available before diving deeper.`,
  {
    query: z.string().describe('Search query — method name, component name, topic, class name, etc.'),
    scope: z.enum(['all', 'api', 'sdk', 'ui', 'examples', 'template', 'tool'])
      .default('all')
      .describe('Category to search in'),
    language: z.enum(['all', 'php', 'js', 'ts', 'python', 'vue', 'css', 'markdown'])
      .default('all')
      .describe('Language filter'),
    limit: z.number().min(1).max(50).default(20)
      .describe('Maximum number of results'),
  },
  async ({ query, scope, language, limit }) => {
    const results = searchIndex(await getIndex(), query, { scope, language, limit })

    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No results found for "${query}" in scope "${scope}". Try broader terms or a different scope.`,
        }],
      }
    }

    const text = results.map((r, i) => {
      const score = `📊 Score: ${r.score.toFixed(2)}`
      const meta = `📂 ${r.category} | 💻 ${r.language}`
      return [
        `### ${i + 1}. ${r.title}`,
        meta,
        score,
        `📁 ${r.path}`,
        `> ${r.snippet}`,
        '',
      ].join('\n')
    }).join('---\n')

    return {
      content: [{
        type: 'text',
        text: `Found ${results.length} result(s) for "${query}":\n\n${text}`,
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 2: b24hub_get — Read any file from the hub
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_get',
  `Read a file from the Bitrix24 developer hub. Long files are paged ` +
  `(default ${DEFAULT_PAGE_CHARS} chars) with a heading outline; pass offset to continue. ` +
  `Use b24hub_search first to find the path.`,
  {
    path: z.string().describe('File path relative to the hub root (e.g., "sdks/php/src/Services/CRM/Lead/LeadService.php")'),
    ...pageFields,
  },
  async ({ path, offset, limit }) => {
    try {
      const content = await readFileContent(path)
      return {
        content: [{
          type: 'text',
          text: formatDocPage({ title: path, path, content, offset, limit }),
        }],
      }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Error reading file "${path}": ${e.message}. Use b24hub_search to find the correct path.` }],
        isError: true,
      }
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 3: b24hub_api_method — Get REST API method docs
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_api_method',
  `Get documentation for a Bitrix24 REST API method. Default response is a structured catalog ` +
  `(scope, params, nested fields, returns, errors, one example) parsed from the local docs — ` +
  `the same shape the official Bitrix24 MCP advertises, so you do not invent field names. ` +
  `field=markdown returns the paged source (default ${DEFAULT_PAGE_CHARS} chars). ` +
  `filter narrows tabbed params (Lead, Deal, entityTypeId) or examples by language. ` +
  `Input the method name in dot notation (e.g., "crm.lead.add", "crm.item.add").`,
  {
    method: z.string().describe('REST API method name in dot notation (e.g., "crm.lead.add", "user.get", "tasks.task.list")'),
    field: z.enum(['all', 'parameters', 'returns', 'errors', 'examples', 'markdown'])
      .default('all')
      .describe('Catalog section to return. Default all. markdown = paged source with outline.'),
    filter: z.string().default('')
      .describe('Narrow parameters by variant (Lead, Deal, 1) or examples by language (js, php, webhook).'),
    ...pageFields,
  },
  async ({ method, field, filter, offset, limit }) => {
    const result = await findApiMethod(method)

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: `REST API method "${method}" not found in local documentation. Try using b24hub_search with scope "api" to find related methods.`,
        }],
        isError: true,
      }
    }

    if (field === 'markdown') {
      return {
        content: [{
          type: 'text',
          text: formatDocPage({
            title: `# ${method}`,
            path: result.path,
            content: result.content,
            offset,
            limit,
          }),
        }],
      }
    }

    const catalog = parseMethodDoc({
      content: result.content,
      path: result.path,
      method,
    })
    return {
      content: [{
        type: 'text',
        text: formatCatalog(catalog, { field, filter }),
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 4: b24hub_api_event — Get REST API event docs
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_api_event',
  `Get documentation for a Bitrix24 REST API event (webhook/event handler). ` +
  `Input the event name (e.g., "OnCrmLeadAdd", "OnTaskAdd").`,
  {
    event: z.string().describe('Event name (e.g., "OnCrmLeadAdd", "OnTaskAdd", "OnAfterUserAdd")'),
    ...pageFields,
  },
  async ({ event, offset, limit }) => {
    const result = await findApiEvent(event)

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: `Event "${event}" not found. Try b24hub_search with the event name to find related documentation.`,
        }],
        isError: true,
      }
    }

    return {
      content: [{
        type: 'text',
        text: formatDocPage({
          title: `# Event: ${event}`,
          path: result.path,
          content: result.content,
          offset,
          limit,
        }),
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 5: b24hub_sdk_ref — Get SDK class/method source
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_sdk_ref',
  `Get SDK source code for a specific class, method, or service. Searches in the PHP, JavaScript, or Python SDK source code. ` +
  `Returns the full source file where the item is defined.`,
  {
    name: z.string().describe('Class, method, or service name (e.g., "LeadService", "B24Hook", "Client")'),
    sdk: z.enum(['php', 'js', 'python']).describe('Which SDK to search in'),
    ...pageFields,
  },
  async ({ name, sdk, offset, limit }) => {
    const result = await findSdkReference(name, sdk)

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: `"${name}" not found in ${sdk} SDK. Try b24hub_search with scope "sdk" to discover available classes.`,
        }],
        isError: true,
      }
    }

    return {
      content: [{
        type: 'text',
        text: formatDocPage({
          title: `# ${name} (${sdk} SDK)`,
          path: result.path,
          content: result.content,
          offset,
          limit,
        }),
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 6: b24hub_ui_component — Get UI component details
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_ui_component',
  `Get source code and documentation for a Bitrix24 UI Kit component. ` +
  `Returns the Vue component source, props, slots, and related documentation.`,
  {
    name: z.string().describe('Component name (e.g., "Button", "InputText", "DataTable", "Sidebar")'),
    ...pageFields,
  },
  async ({ name, offset, limit }) => {
    const result = await findUiComponent(name)

    if (!result) {
      return {
        content: [{
          type: 'text',
          text: `UI component "${name}" not found. Try b24hub_search with scope "ui" to discover available components.`,
        }],
        isError: true,
      }
    }

    let body = result.content
    if (result.docs) {
      body += `\n\n---\n\n# Documentation\n📁 Docs: ${result.docsPath}\n\n${result.docs}`
    }

    return {
      content: [{
        type: 'text',
        text: formatDocPage({
          title: `# Component: ${name}`,
          path: result.path,
          content: body,
          offset,
          limit,
        }),
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 7: b24hub_examples — Find code examples
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_examples',
  `Find code examples for a specific topic or use case. Searches examples/sdk-examples (php, js) ` +
  `and sdks/python/examples. Returns matching example code with language labels.`,
  {
    topic: z.string().describe('Topic or use case to find examples for (e.g., "auth", "crud", "webhook", "deal", "batch")'),
    language: z.enum(['all', 'php', 'js', 'python']).default('all')
      .describe('Programming language filter'),
  },
  async ({ topic, language }) => {
    const results = await findExamples(topic, language)

    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No examples found for "${topic}". Try broader terms or use b24hub_search with scope "examples".`,
        }],
      }
    }

    const text = results.map((r, i) => {
      return `### Example ${i + 1}: ${r.path}\n💻 Language: ${r.language}\n\n${r.content}`
    }).join('\n\n---\n\n')

    return {
      content: [{
        type: 'text',
        text: `Found ${results.length} example(s) for "${topic}":\n\n${text}`,
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 8: b24hub_list — List available resources by category
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_list',
  `List all available resources in a specific category. Use this to discover what's available ` +
  `before searching for specific items. Supports filtering by prefix. ` +
  `sdk-scopes returns REST permission codes from permissions.md (crm, task, user, …). ` +
  `sdk-services lists php/<Scope>, python/<scope>, js/<module> (hook, frame, oauth, …). ` +
  `examples includes php/*, js/*, and python/<scope> from sdks/python/examples.`,
  {
    category: z.enum([
      'api-methods',
      'api-events',
      'sdk-services',
      'ui-components',
      'examples',
      'sdk-scopes',
    ]).describe('Resource category to list'),
    filter: z.string().default('').describe('Optional prefix filter (e.g., "crm" to list only CRM-related items)'),
  },
  async ({ category, filter }) => {
    const items = await listResources(category, filter)

    if (items.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No items found in category "${category}"${filter ? ` matching "${filter}"` : ''}.`,
        }],
      }
    }

    const header = `## ${category}${filter ? ` (filtered: "${filter}")` : ''}\nFound ${items.length} items:\n`
    const list = items.map((item, i) => `${i + 1}. \`${item}\``).join('\n')

    return {
      content: [{ type: 'text', text: header + list }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 9: b24hub_grep — Content search with context
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24hub_grep',
  `Search for text patterns inside hub files with surrounding context. Like grep but returns ` +
  `matching lines with context. Results are cached and ranked by path relevance. ` +
  `Useful for finding specific API calls, configurations, or patterns.`,
  {
    pattern: z.string().describe('Text pattern to search for'),
    directory: z.enum([
      'sdks/php',
      'sdks/js',
      'sdks/python',
      'ui/components',
      'ui/style',
      'ui/icons',
      'docs/rest-api',
      'examples/sdk-examples',
      'examples/app-template-automation',
      'tools/crest',
    ]).describe('Directory to search in'),
    maxResults: z.number().min(1).max(50).default(10)
      .describe('Maximum number of files to return'),
  },
  async ({ pattern, directory, maxResults }) => {
    const results = await searchFiles(directory, pattern, { maxResults })

    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `No matches for "${pattern}" in ${directory}.`,
        }],
      }
    }

    const text = results.map(r => {
      const matchText = r.matches.map(m => {
        return `  Line ${m.line}:\n${m.context.split('\n').map(l => `    ${l}`).join('\n')}`
      }).join('\n')
      return `📁 ${r.path}\n${matchText}`
    }).join('\n\n---\n\n')

    return {
      content: [{
        type: 'text',
        text: `Found "${pattern}" in ${results.length} file(s) inside ${directory}:\n\n${text}`,
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 10: b24_call — Live Bitrix24 REST call via a locally configured webhook
// ─────────────────────────────────────────────────────────────

registerTool(
  'b24_call',
  `Make a LIVE REST API call against the user's Bitrix24 portal, configured via a local ` +
  `.b24.config.json file (gitignored). Works like a Postman call: provide a method name ` +
  `(e.g., "crm.item.list", "crm.status.list", "user.get") and any params, and you ` +
  `get the real JSON response back. Use this to explore actual data — SPA entity types, stages, ` +
  `fields, deals, contacts, tasks — before designing or modifying process flows. ` +
  `The webhook token is read from the local config and is never exposed in the response. ` +
  `Write methods (*.add, *.update, *.delete, event.bind, batch, …) require confirm: true. ` +
  `Good smoke tests: app.info, user.current. ` +
  `NOTE: this performs a real outbound HTTPS request to the portal.` +
  `\n\nRequires setup: copy .b24.config.example.json to .b24.config.json and fill in baseUrl, ` +
  `userId and webhookToken. Set B24_PROFILE to pick a non-default profile, or B24_CONFIG_PATH ` +
  `to point at a custom config location.`,
  {
    method: z.string().describe('REST API method in dot notation (e.g., "crm.item.list", "user.get")'),
    params: z.record(z.unknown()).default({})
      .describe('Request parameters as a JSON object (e.g., { entityTypeId: 152, filter: {...} })'),
    start: z.number().int().min(0).optional()
      .describe('Pagination offset for *.list methods (Bitrix24 "start" param). Omit on the first page.'),
    confirm: z.boolean().default(false)
      .describe('Must be true for methods that mutate the portal (*.add, *.update, *.delete, event.bind, batch, …).'),
  },
  async ({ method, params, start, confirm }) => {
    const blocked = assertMutationAllowed(method, confirm)
    if (blocked) {
      return {
        content: [{ type: 'text', text: blocked }],
        isError: true,
      }
    }
    let cfg
    try {
      cfg = await loadEndpointConfig()
    } catch (e) {
      return {
        content: [{ type: 'text', text: `❌ Invalid Bitrix24 endpoint config: ${e.message}` }],
        isError: true,
      }
    }

    if (!cfg) {
      return {
        content: [{
          type: 'text',
          text:
            `⚙️ Bitrix24 live calls are not configured yet.\n\n` +
            `Copy \`.b24.config.example.json\` to \`.b24.config.json\` at the repo root ` +
            `and fill in your webhook details:\n\n` +
            `\`\`\`json\n` +
            `{\n` +
            `  "profiles": {\n` +
            `    "default": {\n` +
            `      "baseUrl": "https://your-portal.bitrix24.com",\n` +
            `      "userId": "89",\n` +
            `      "webhookToken": "your-inbound-webhook-token"\n` +
            `    }\n` +
            `  }\n` +
            `}\n` +
            `\`\`\`\n\n` +
            `Then create the inbound webhook in Bitrix24 (Developer resources → Inbound webhook) ` +
            `with the scopes you need (crm, tasks, user, ...). The file is gitignored — the token ` +
            `stays on your machine.`,
        }],
        isError: true,
      }
    }

    try {
      const result = await callB24Method(cfg, method, params, { start })
      return {
        content: [{ type: 'text', text: formatB24Result(method, result, start ?? 0) }],
      }
    } catch (e) {
      const parts = [`❌ \`${method}\` failed: ${e.message}`]
      if (e.response !== undefined) {
        parts.push('```json\n' + JSON.stringify(e.response, null, 2).slice(0, 4000) + '\n```')
      }
      return {
        content: [{ type: 'text', text: parts.join('\n\n') }],
        isError: true,
      }
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Resources + named prompts
// ─────────────────────────────────────────────────────────────

async function hubMarkdown(relativePath) {
  try {
    return await readFileContent(relativePath)
  } catch (e) {
    return `Not found: ${relativePath} (${e.message})`
  }
}

server.registerResource(
  'skill',
  'b24://skill',
  { description: 'Agent playbook: intent → MCP tool', mimeType: 'text/markdown' },
  async uri => ({
    contents: [{
      uri: String(uri),
      mimeType: 'text/markdown',
      text: await hubMarkdown('.cursor/skills/b24-dev-hub/SKILL.md'),
    }],
  }),
)

server.registerResource(
  'conventions',
  'b24://conventions',
  { description: 'Bitrix24 SPA, stages, auth, and SDK entry points', mimeType: 'text/markdown' },
  async uri => ({
    contents: [{
      uri: String(uri),
      mimeType: 'text/markdown',
      text: await hubMarkdown('.cursor/skills/b24-dev-hub/bitrix24-conventions.md'),
    }],
  }),
)

server.registerResource(
  'scopes',
  'b24://scopes',
  { description: 'REST permission scope codes', mimeType: 'text/markdown' },
  async uri => ({
    contents: [{
      uri: String(uri),
      mimeType: 'text/markdown',
      text: await hubMarkdown('docs/rest-api/api-reference/scopes/permissions.md'),
    }],
  }),
)

server.registerResource(
  'methods',
  'b24://methods',
  { description: 'Inventory of REST method doc filenames', mimeType: 'text/plain' },
  async uri => {
    const names = await listResources('api-methods')
    return {
      contents: [{
        uri: String(uri),
        mimeType: 'text/plain',
        text: names.join('\n'),
      }],
    }
  },
)

server.registerResource(
  'method',
  new ResourceTemplate('b24://method/{name}', {
    list: async () => {
      const names = await listResources('api-methods')
      return {
        resources: names.slice(0, 80).map(name => ({
          uri: methodResourceUri(name),
          name,
          mimeType: 'text/markdown',
          description: 'REST method documentation',
        })),
      }
    },
    complete: {
      name: async value => {
        const names = await listResources('api-methods', String(value || ''))
        return names.slice(0, 20).map(n => n.replace(/-/g, '.'))
      },
    },
  }),
  { description: 'Bitrix24 REST method documentation by name', mimeType: 'text/markdown' },
  async (uri, variables) => {
    const method = String(variables.name || '').replace(/-/g, '.')
    const result = await findApiMethod(method)
    let text
    if (!result) {
      text = `REST API method "${method}" not found. Use b24hub_search with scope "api".`
    } else {
      text = formatCatalog(parseMethodDoc({
        content: result.content,
        path: result.path,
        method,
      }))
    }
    return {
      contents: [{ uri: String(uri), mimeType: 'text/markdown', text }],
    }
  },
)

server.registerPrompt(
  'spa-discovery',
  {
    description: 'Discover SPA entity types, fields, and stages on the live portal (crm.status.list).',
    argsSchema: {
      entityTypeId: z.string().optional().describe('SPA entityTypeId if already known'),
    },
  },
  async args => buildPrompt('spa-discovery', args || {}),
)

server.registerPrompt(
  'event-handler',
  {
    description: 'Recipe to document an event and register a handler via event.bind.',
    argsSchema: {
      event: z.string().optional().describe('Event name (e.g. OnCrmLeadAdd)'),
    },
  },
  async args => buildPrompt('event-handler', args || {}),
)

server.registerPrompt(
  'local-app',
  {
    description: 'Scaffold a local Bitrix24 app (webhook or iframe) in php, js, or python.',
    argsSchema: {
      language: z.string().optional().describe('php, js, or python'),
    },
  },
  async args => buildPrompt('local-app', args || {}),
)

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
transport.onerror = (error) => {
  console.error('[b24-dev-hub] stdio error:', error)
}
await server.connect(transport)

console.error('[b24-dev-hub] MCP server running on stdio')
