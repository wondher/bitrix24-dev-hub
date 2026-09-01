# Referência das tools MCP do b24-dev-hub

Fonte: `mcp-server/index.js` e `mcp-server/lib/*.js` no clone do hub (`B24_HUB_ROOT`, ou `~/.b24-dev-hub`). Namespace Cursor: `user-b24-dev-hub`.

Invocar com `CallDynamicTool` (schema via `GetDynamicTools` se ainda não visto nesta sessão).

---

## 1. `b24_call` — REST live no portal

Única tool com rede. Estilo Postman: `method` + `params` → JSON real. Token lido do config; **nunca** volta na resposta.

| Param | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `method` | string | sim | Dot notation (`crm.item.list`, `crm.status.list`, `user.get`) |
| `params` | object | não | Corpo JSON (`{ entityTypeId: 152, filter: {...} }`) |
| `start` | int ≥ 0 | não | Offset de `*.list`. Omitir na 1ª página |
| `confirm` | bool | nas escritas | `true` para `*.add` / `*.update` / `*.delete` / `event.bind` / `batch`. Sem isso a tool recusa e não chama o portal. |

Auth: webhook inbound **v1**. URL interna (você não monta): `https://<baseUrl>/rest/<userId>/<webhookToken>/<method>.json`.

Config (`.b24.config.json`):

- Flat: `{ baseUrl, userId, webhookToken }`
- Profiles: `{ profiles: { default: {...}, prod: {...} } }`

`B24_PROFILE` (default `default`). Path: `B24_CONFIG_PATH` (absoluto) senão `<hubRoot>/.b24.config.json`. `baseUrl` deve ser `https://`, `userId` numérico.

Resposta: `✅ method`, `📊 Total` se houver, `📌 Next page: start: N`, JSON truncado ~20 KB. Sem config → instruções de setup (não é crash).

**Quando não usar:** documentação (`b24hub_api_method`); exploração só conceitual (`b24hub_*`); OAuth / REST v3 (gere código no SDK). Mutação só com pedido explícito **e** `confirm: true`.

---

## 2. `b24hub_api_method` — doc de método REST

| Param | Tipo | Obrigatório |
|---|---|---|
| `method` | string | sim — `crm.lead.add`, `tasks.task.list` |
| `field` | enum | não — `all` (default) \| `parameters` \| `returns` \| `errors` \| `examples` \| `markdown` |
| `filter` | string | não — variante tabbed (`Lead`, `Deal`, `1`) ou linguagem do exemplo |
| `offset` / `limit` | int | só com `field=markdown` |

Procura em `docs/rest-api/api-reference/**/*.md`. O default é um **catálogo rotulado** (Method, Scope, Parameters, Returns, Errors, Example, Live) parseado das tabelas YFM — o mesmo formato que o MCP oficial (`bitrix-method-details`) usa para a IA não inventar campos. `field=markdown` devolve o source paginado com outline.

SPA/`crm.item.*`: params tabbed ficam colapsados; `filter: "Lead"` (ou `entityTypeId`) lista os campos da variante.

**Quando não usar:** evento (`OnCrmLeadAdd`) → `b24hub_api_event`; tópico sem nome → `b24hub_search({ scope: "api" })`; inventário → `b24hub_list({ category: "api-methods", filter: "crm" })`.

---

## 3. `b24hub_search` — BM25 no hub inteiro

| Param | Default | Descrição |
|---|---|---|
| `query` | — | Método, componente, classe, tópico |
| `scope` | `all` | `all` \| `api` \| `sdk` \| `ui` \| `examples` \| `template` \| `tool` |
| `language` | `all` | `all` \| `php` \| `js` \| `ts` \| `python` \| `vue` \| `css` \| `markdown` |
| `limit` | 20 | 1–50 |

Devolve `title`, `category`, `language`, `score`, `path`, `snippet`. Espera o índice (construído em paralelo ao handshake).

**Quando não usar:** nome exato de método → `b24hub_api_method`; path conhecido → `b24hub_get`; substring + linhas → `b24hub_grep`; componente certo → `b24hub_ui_component`.

---

## 4. `b24hub_sdk_ref` — source de classe/serviço

| Param | Obrigatório |
|---|---|
| `name` | sim — `LeadService`, `B24Hook`, `Client` |
| `sdk` | sim — `php` \| `js` \| `python` |
| `offset` / `limit` | não — mesma paginação das docs REST |

- `php` → `sdks/php/src/` (entry `ServiceBuilderFactory`)
- `js` → `sdks/js/packages/` (`jssdk`, `jssdk-nuxt`; entry `initializeB24Frame` / `B24Hook`)
- `python` → `sdks/python/` (`b24pysdk`; entry `Client`)

**Quando não usar:** conceito sem nome de classe → `b24hub_search({ scope: "sdk" })`; exemplos de uso → `b24hub_examples`.

---

## 5. `b24hub_ui_component` — UI Kit Vue/Nuxt

| Param | Obrigatório |
|---|---|
| `name` | sim — `Button`, `InputText`, `DataTable` |
| `offset` / `limit` | não — mesma paginação das docs REST |

Glob `ui/components/src/runtime/components/**/*.vue`. Package `@bitrix24/b24ui-nuxt`. Devolve source + docs.

**Quando não usar:** design tokens → `b24hub_grep({ directory: "ui/style" })`; ícones → `ui/icons`; nome incerto → `b24hub_list({ category: "ui-components" })`. Em UI Kit, leia também `ui/components/AGENTS.md` via `b24hub_get`.

---

## 6. `b24hub_examples` — exemplos por tópico

| Param | Default |
|---|---|
| `topic` | — `auth`, `crud`, `webhook`, `deal`, `batch` |
| `language` | `all` — `php` \| `js` \| `python` |

Só varre `examples/sdk-examples/` (`php/` e `js/`) **e** `sdks/python/examples`. `language: "python"` encontra os snippets oficiais do SDK.

Template full-stack (Docker/Nuxt/consumers) → `b24hub_search({ scope: "template" })` ou grep em `examples/app-template-automation`.

---

## 7. `b24hub_list` — inventário

| Param | Obrigatório |
|---|---|
| `category` | sim — ver tabela |
| `filter` | não — prefixo (`crm`) |

| category | O que lista |
|---|---|
| `api-methods` | basenames `.md` em `docs/rest-api/api-reference/**` |
| `api-events` | infra de eventos (`event-bind`, etc.) |
| `sdk-services` | `php/<Scope>`, `python/<scope>`, `js/<module>` (hook, frame, oauth, …) |
| `ui-components` | basenames `.vue` |
| `examples` | `<lang>/<projeto>` em `examples/sdk-examples/` **e** `python/<scope>` em `sdks/python/examples` |
| `sdk-scopes` | códigos REST de `docs/rest-api/api-reference/scopes/permissions.md` (`crm`, `task`, `user`, …) |

---

## 8. `b24hub_grep` — substring + contexto

| Param | Notas |
|---|---|
| `pattern` | **Substring case-insensitive, não regex** |
| `directory` | enum fixo (ver SKILL.md) |
| `maxResults` | 1–50 arquivos (default 10) |

2 linhas de contexto. Única entrada estruturada em `ui/icons`, `ui/style`, `examples/app-template-automation`, `tools/crest`.

---

## 9. `b24hub_get` — ler path

`path` relativo ao hub root, UTF-8. Default ~12 KB com outline; continue com `offset`. Inexistente → erro sugerindo `b24hub_search`.

---

## 10. `b24hub_api_event` — doc de evento

`event`: `OnCrmLeadAdd`, `OnTaskAdd`. Infra em `**/events/**/*.md`; eventos de domínio caem no fallback por conteúdo.

Registrar handler é **método** `event.bind`, não evento — use `b24hub_api_method`.

---

## Fallbacks das tools

Especializada vazia → sugere `b24hub_search`. `b24_call` sem config → setup, não crash.

Índice BM25: `<hubRoot>/.b24-index/index.json`, invalidado pelo hash de `git submodule status`. Handshake não espera o índice. Depois de atualizar submódulos: `b24-dev-hub reindex` ou `b24-dev-hub update`.

Resources: `b24://skill`, `b24://conventions`, `b24://scopes`, `b24://methods`, `b24://method/{name}`.

Prompts: `spa-discovery`, `event-handler`, `local-app`.
