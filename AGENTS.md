# Bitrix24 Developer Hub

Local hub of official Bitrix24 SDKs, REST docs, UI Kit, examples, and templates. Agents work through the **b24-dev-hub MCP** (10 tools). Playbook: [`.cursor/skills/b24-dev-hub/SKILL.md`](.cursor/skills/b24-dev-hub/SKILL.md). Conventions (SPA, stages, auth): [`.cursor/skills/b24-dev-hub/bitrix24-conventions.md`](.cursor/skills/b24-dev-hub/bitrix24-conventions.md). UI Kit: [`ui/components/AGENTS.md`](ui/components/AGENTS.md).

## Intent → tool

| Intent | Tool |
|--------|------|
| Live portal data | `b24hub_api_method` (signature) then `b24_call` |
| REST method (`crm.lead.add`) | `b24hub_api_method` |
| Event (`OnCrmLeadAdd`) | `b24hub_api_event` |
| SDK class (`B24Hook`, `Client`) | `b24hub_sdk_ref` |
| UI Kit component | `b24hub_ui_component` |
| Example by topic | `b24hub_examples` |
| Known path | `b24hub_get` |
| Inventory (`api-methods`, `sdk-scopes`, …) | `b24hub_list` |
| Substring in a hub directory | `b24hub_grep` |
| Explore / unknown name | `b24hub_search` |

Do not invent REST URLs with a webhook token. The token stays in gitignored `.b24.config.json`.

## Live portal (`b24_call`)

Inbound webhook, REST v1 only. Copy `.b24.config.example.json` → `.b24.config.json`. Override with `B24_CONFIG_PATH` / `B24_PROFILE`. Missing config → the tool returns setup instructions.

Reads (`*.list`, `*.get`, `*.fields`, `app.info`, `user.current`) after reading the method doc. Writes (`*.add`, `*.update`, `*.delete`, `event.bind`, `batch`) require `confirm: true` on `b24_call`, and only when the user asked to create, change, or delete.

Long docs (`b24hub_get`, …) return an outline plus a page; continue with `offset`. `b24hub_api_method` returns a structured catalog (params, errors, scope); pass `field: "markdown"` for the paged source. Named prompts: `spa-discovery`, `event-handler`, `local-app`. Resources: `b24://method/{name}`, `b24://skill`.

**Stages:** `crm.status.list` with `filter.ENTITY_ID` — Lead `STATUS`, Deal `DEAL_STAGE` (or `DEAL_STAGE_<id>`), SPA `DYNAMIC_<entityTypeId>_STAGE_<categoryId>`. `crm.stage.list` does not exist.

## Layout (MCP down)

```
sdks/{php,js,python}   UI: ui/{components,style,icons}
docs/rest-api          examples/{sdk-examples,app-template-automation}
tools/crest            mcp-server
```
