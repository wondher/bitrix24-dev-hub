# Golden tasks — b24-dev-hub

Retrieval and routing checks that a fresh agent (repo + MCP, no personal skill) must pass. Automated in `mcp-server/test/golden.test.js`. Skipped in CI when submodules are not checked out.

## Retrieval

| # | Query | Expected |
|---|---|---|
| 1 | `crm.lead.add` | `b24hub_api_method` → `crm-lead-add.md` |
| 2 | pipeline / stages | `crm.status.list` with `filter.ENTITY_ID` — not `crm.stage.list`, not `crm.dealcategory.stage.list` |
| 3 | `crm.item.list` | `b24hub_api_method` → `crm-item-list.md` |
| 4 | `OnCrmLeadAdd` | `b24hub_api_event` → `leads/events/on-crm-lead-add.md` |
| 5 | `event.bind` | `b24hub_api_method` → `event-bind.md` (method, not event) |
| 6 | `Button` | `b24hub_ui_component` → `Button.vue` |
| 7 | `B24Hook` + js | `b24hub_sdk_ref` → `packages/jssdk/src/hook/b24.ts` |
| 8 | `ServiceBuilderFactory` + php | `b24hub_sdk_ref` → `ServiceBuilderFactory.php` |
| 9 | `Client` + python | `b24hub_sdk_ref` → `b24pysdk/client.py` |
| 10 | `b24hub_list({ category: "sdk-scopes" })` | includes `crm`, `task`, `user` |
| 11 | `b24hub_examples({ topic: "lead", language: "python" })` | path under `sdks/python/examples` |
| 12 | `b24hub_list({ category: "sdk-services" })` | `php/CRM`, `python/crm`, `js/hook` |
| 13 | `b24hub_api_method({ method: "crm.lead.add" })` | catalog with `TITLE`, scope `crm`, not raw `{% include` |

## Routing

Intent table lives in `.cursor/skills/b24-dev-hub/SKILL.md` (detail) and `AGENTS.md` (always-on pointer). Stages one-liner: `crm.status.list`. Writes via `b24_call` need `confirm: true`. `b24hub_api_method` default is a structured catalog; `field: "markdown"` for the paged source.

## Live (manual)

`b24_call({ method: "app.info" })` after `.b24.config.json` is present. Not run in CI. `crm.lead.add` without `confirm` must be refused.
