/**
 * MCP resources and named prompts for the hub.
 * Resource URIs: b24://method/{name}, b24://skill, b24://conventions, b24://scopes, b24://methods
 * Prompts: spa-discovery, event-handler, local-app
 */

const PROMPT_NAMES = new Set(['spa-discovery', 'event-handler', 'local-app'])

/**
 * @param {string} name  Dot notation or kebab filename (`crm.lead.add` / `crm-lead-add`)
 * @returns {string}
 */
export function methodResourceUri(name) {
  const dotted = String(name || '')
    .trim()
    .replace(/-/g, '.')
  return `b24://method/${dotted}`
}

/**
 * @param {'spa-discovery' | 'event-handler' | 'local-app'} name
 * @param {Record<string, string>} [args]
 */
export function buildPrompt(name, args = {}) {
  if (!PROMPT_NAMES.has(name)) {
    throw new Error(`Unknown prompt "${name}". Available: spa-discovery, event-handler, local-app.`)
  }
  const text = name === 'spa-discovery'
    ? spaDiscoveryText(args)
    : name === 'event-handler'
      ? eventHandlerText(args)
      : localAppText(args)
  return {
    messages: [{
      role: 'user',
      content: { type: 'text', text },
    }],
  }
}

function spaDiscoveryText({ entityTypeId } = {}) {
  const id = entityTypeId ? String(entityTypeId) : '<entityTypeId from entity-type.list>'
  return [
    'Discover a Bitrix24 SPA (smart process) on the configured portal, then stop.',
    '',
    '1. b24hub_api_method for each method you will call (catalog of params/errors; field=markdown only if you need the full page).',
    '2. b24_call { method: "app.info" } — smoke test the webhook.',
    '3. b24_call { method: "crm.item.entity-type.list" } — list entity types. Do not copy IDs from tutorials.',
    `4. b24_call { method: "crm.item.list", params: { entityTypeId: ${id} } }`,
    `5. b24_call { method: "crm.item.fields", params: { entityTypeId: ${id} } }`,
    `6. Stages: b24_call { method: "crm.status.list", params: { filter: { ENTITY_ID: "DYNAMIC_${id}_STAGE_0" }, order: { SORT: "ASC" } } }.`,
    '   Lead uses ENTITY_ID STATUS; Deal uses DEAL_STAGE. crm.stage.list does not exist.',
    '7. Reads only. Any *.add/*.update/*.delete needs confirm: true and an explicit user request.',
  ].join('\n')
}

function eventHandlerText({ event } = {}) {
  const name = event ? String(event) : 'OnCrmLeadAdd'
  return [
    `Build an event handler for ${name}.`,
    '',
    `1. b24hub_api_event { event: "${name}" } — payload shape.`,
    '2. b24hub_api_method { method: "event.bind" } — registering a handler is a REST method, not an event.',
    '3. b24hub_examples { topic: "webhook" } (and language python → sdks/python/examples).',
    '4. Prefer event.offline.get / event.offline.done for production.',
    '5. Do not call event.bind live unless the user asked to register a handler (confirm: true).',
  ].join('\n')
}

function localAppText({ language } = {}) {
  const lang = ['php', 'js', 'python'].includes(language) ? language : 'js'
  const entry = lang === 'php'
    ? 'ServiceBuilderFactory'
    : lang === 'python'
      ? 'Client'
      : 'B24Hook (webhook) or initializeB24Frame (iframe)'
  return [
    `Scaffold a local Bitrix24 app in ${lang}.`,
    '',
    `1. b24hub_sdk_ref { name: "${lang === 'js' ? 'B24Hook' : entry.split(' ')[0]}", sdk: "${lang}" }`,
    lang === 'js' ? '   Also b24hub_sdk_ref { name: "initializeB24Frame", sdk: "js" } for iframe apps.' : '',
    '2. b24hub_examples { topic: "auth", language: "' + lang + '" }',
    '3. Webhook inbound for a single portal; OAuth (B24OAuth / BitrixToken) for Marketplace.',
    '4. UI Kit: b24hub_ui_component + ui/components/AGENTS.md. Semantic b24-* colors, never hex.',
    '5. Token stays in .b24.config.json (gitignored). Do not invent REST URLs with the webhook token.',
  ].filter(Boolean).join('\n')
}
