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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
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
import { runCli } from './cli.js'

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
const index = await getOrBuildIndex()
console.error(`[b24-dev-hub] Index ready (${index.entries.length} files)`)

// ─────────────────────────────────────────────────────────────
// Tool 1: b24hub_search — Universal search across all repos
// ─────────────────────────────────────────────────────────────

server.tool(
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
    const results = searchIndex(index, query, { scope, language, limit })

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

server.tool(
  'b24hub_get',
  `Read the full content of any file in the Bitrix24 developer hub. Use b24hub_search first to find relevant files, then b24hub_get to read them.`,
  {
    path: z.string().describe('File path relative to the hub root (e.g., "sdks/php/src/Services/CRM/Lead/LeadService.php")'),
  },
  async ({ path }) => {
    try {
      const content = await readFileContent(path)
      return {
        content: [{ type: 'text', text: content }],
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

server.tool(
  'b24hub_api_method',
  `Get detailed documentation for a Bitrix24 REST API method. Returns parameters, examples, response format, and error codes. ` +
  `Input the method name in dot notation (e.g., "crm.lead.add", "disk.file.upload").`,
  {
    method: z.string().describe('REST API method name in dot notation (e.g., "crm.lead.add", "user.get", "tasks.task.list")'),
  },
  async ({ method }) => {
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

    return {
      content: [{
        type: 'text',
        text: `# ${method}\n📁 Source: ${result.path}\n\n${result.content}`,
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 4: b24hub_api_event — Get REST API event docs
// ─────────────────────────────────────────────────────────────

server.tool(
  'b24hub_api_event',
  `Get documentation for a Bitrix24 REST API event (webhook/event handler). ` +
  `Input the event name (e.g., "OnCrmLeadAdd", "OnTaskAdd").`,
  {
    event: z.string().describe('Event name (e.g., "OnCrmLeadAdd", "OnTaskAdd", "OnAfterUserAdd")'),
  },
  async ({ event }) => {
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
        text: `# Event: ${event}\n📁 Source: ${result.path}\n\n${result.content}`,
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 5: b24hub_sdk_ref — Get SDK class/method source
// ─────────────────────────────────────────────────────────────

server.tool(
  'b24hub_sdk_ref',
  `Get SDK source code for a specific class, method, or service. Searches in the PHP, JavaScript, or Python SDK source code. ` +
  `Returns the full source file where the item is defined.`,
  {
    name: z.string().describe('Class, method, or service name (e.g., "LeadService", "B24Hook", "Client")'),
    sdk: z.enum(['php', 'js', 'python']).describe('Which SDK to search in'),
  },
  async ({ name, sdk }) => {
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
        text: `# ${name} (${sdk} SDK)\n📁 Source: ${result.path}\n\n${result.content}`,
      }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 6: b24hub_ui_component — Get UI component details
// ─────────────────────────────────────────────────────────────

server.tool(
  'b24hub_ui_component',
  `Get source code and documentation for a Bitrix24 UI Kit component. ` +
  `Returns the Vue component source, props, slots, and related documentation.`,
  {
    name: z.string().describe('Component name (e.g., "Button", "InputText", "DataTable", "Sidebar")'),
  },
  async ({ name }) => {
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

    let text = `# Component: ${name}\n📁 Source: ${result.path}\n\n${result.content}`

    if (result.docs) {
      text += `\n\n---\n\n# 📖 Documentation\n📁 Docs: ${result.docsPath}\n\n${result.docs}`
    }

    return {
      content: [{ type: 'text', text }],
    }
  }
)

// ─────────────────────────────────────────────────────────────
// Tool 7: b24hub_examples — Find code examples
// ─────────────────────────────────────────────────────────────

server.tool(
  'b24hub_examples',
  `Find code examples for a specific topic or use case. Searches across all SDK example projects ` +
  `and ranks results by relevance. Returns matching example code with language labels.`,
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

server.tool(
  'b24hub_list',
  `List all available resources in a specific category. Use this to discover what's available ` +
  `before searching for specific items. Supports filtering by prefix.`,
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

server.tool(
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
// Start server
// ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)

console.error('[b24-dev-hub] MCP server running on stdio')
