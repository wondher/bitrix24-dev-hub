---
name: b24-dev-hub
description: >-
  Routes Bitrix24 work through the b24-dev-hub MCP: REST methods, events,
  SDKs (PHP/JS/Python), UI Kit, examples, CRest, and live portal calls.
  Use when the user mentions Bitrix24, Bitrix, CRM, SPA, Smart Process,
  webhook, OAuth, crm.item, tasks.task, OnCrmLeadAdd, b24hub_*, b24_call,
  or asks to search/list/grep the hub. If the user names a tool, call that
  tool; otherwise auto-explore with b24hub_search or b24hub_list.
---

# b24-dev-hub

MCP local do hub Bitrix24. Namespace Cursor: **`user-b24-dev-hub`**.

O hub indexa SDKs, docs REST, UI Kit e exemplos. Root: `B24_HUB_ROOT` → clone do repo → `~/.b24-dev-hub`. `b24_call` é a única tool com rede — webhook inbound REST v1 via `.b24.config.json` (gitignored).

O servidor conecta o stdio na hora; o índice BM25 sobe em paralelo. `b24hub_search` espera o índice; as outras tools leem o disco direto.

## Como invocar (Cursor)

Se as tools já estão nesta sessão, chame-as direto. Senão:

1. Schema ainda não visto → `GetDynamicTools({ namespace: "user-b24-dev-hub", toolName: "<tool>" })`
2. Chamar → `CallDynamicTool` com `namespace: "user-b24-dev-hub"`, `toolName`, `arguments`, e `mcpDetails.description` (uma frase do que a chamada faz)
3. `namespaceStatus: needsAuth` → `mcp_auth` nesse namespace, depois inspecionar de novo

Não invente endpoints. Só as 10 tools abaixo existem. Não reconstrua URL com webhook token — o token fica no config local e **nunca** deve aparecer em logs, commits ou respostas.

## Dois modos

**Modo indicado** — o usuário nomeou a tool (ou um apelido). Chame **essa** tool. Só troque se ela falhar (not found / schema inválido); nesse caso diga a substituição.

**Modo automático** — o usuário descreveu a intenção. Roteie pela tabela. Descoberta aberta começa em `b24hub_search` (ou `b24hub_list` para inventário). Leia a doc do método com `b24hub_api_method` **antes** de `b24_call`.

Apelidos → tool:

| O usuário diz | Tool |
|---|---|
| search, busca, explorar o hub | `b24hub_search` |
| list, lista, inventário | `b24hub_list` |
| grep, padrão, substring | `b24hub_grep` |
| get, lê o arquivo, path | `b24hub_get` |
| api method, doc do método, `crm.lead.add` | `b24hub_api_method` |
| event, `OnCrmLeadAdd`, webhook handler | `b24hub_api_event` |
| sdk, LeadService, B24Hook, Client | `b24hub_sdk_ref` |
| ui, componente, DataTable, Button | `b24hub_ui_component` |
| example, exemplo, snippet | `b24hub_examples` |
| call, live, portal, Postman, dado real | `b24_call` |

## Roteamento automático

```
Intenção
 ├─ dado REAL do portal (ler/criar/editar)?
 │    sim → b24hub_api_method (assinatura) → b24_call
 │    não ↓
 └─ sabe o NOME EXATO?
      método REST (crm.item.list)     → b24hub_api_method
      evento (OnCrmLeadAdd)           → b24hub_api_event
      classe/serviço SDK              → b24hub_sdk_ref
      componente UI Kit               → b24hub_ui_component
      exemplo por tópico              → b24hub_examples
      path conhecido                  → b24hub_get
      inventário de uma categoria     → b24hub_list
      substring num diretório do hub  → b24hub_grep
      senão / explorar                → b24hub_search
```

## Quick reference

| Intenção | Tool | Obrigatório |
|---|---|---|
| Dado real do portal | `b24_call` | `method` (`params?`, `start?`, `confirm?` nas escritas) |
| Doc de método REST | `b24hub_api_method` | `method` (`field?`, `filter?`, `offset?`/`limit?` se markdown) |
| Doc de evento | `b24hub_api_event` | `event` (`offset?`, `limit?`) |
| Source SDK | `b24hub_sdk_ref` | `name`, `sdk` (`php`/`js`/`python`) (`offset?`, `limit?`) |
| Componente UI Kit | `b24hub_ui_component` | `name` (`offset?`, `limit?`) |
| Exemplos por tópico | `b24hub_examples` | `topic` (`language?`) |
| Descoberta BM25 | `b24hub_search` | `query` (`scope?`, `language?`, `limit?`) |
| Inventário | `b24hub_list` | `category` (`filter?`) |
| Substring + contexto | `b24hub_grep` | `pattern`, `directory` |
| Ler arquivo | `b24hub_get` | `path` (`offset?`, `limit?`) |

`b24hub_search.scope`: `all` \| `api` \| `sdk` \| `ui` \| `examples` \| `template` \| `tool`

`b24hub_list.category`: `api-methods` \| `api-events` \| `sdk-services` \| `ui-components` \| `examples` \| `sdk-scopes`

`b24hub_grep.directory`: `sdks/php` \| `sdks/js` \| `sdks/python` \| `ui/components` \| `ui/style` \| `ui/icons` \| `docs/rest-api` \| `examples/sdk-examples` \| `examples/app-template-automation` \| `tools/crest`

## `b24_call` — live

Webhook inbound **v1 apenas**. Config: `<hub>/.b24.config.json` (ou `B24_CONFIG_PATH`). Profile: `B24_PROFILE` (default `default`). Hub root: `B24_HUB_ROOT` → clone → `~/.b24-dev-hub`.

- Leitura (`*.list`, `*.get`, `*.fields`, `app.info`, `user.current`): pode ir direto depois da doc.
- Mutação (`*.add`, `*.update`, `*.delete`, `event.bind`, `batch`): só se o usuário pediu criar/alterar/apagar, e só com `confirm: true`. Sem `confirm` a tool recusa e **não** chama o portal.
- Sem config → a tool devolve instruções de setup; oriente o usuário, não invente token.
- Payload truncado ~20 KB; próxima página = `start` sugerido na resposta.
- Não cobre REST v3 (`/rest/api/...`) nem OAuth. Para isso gere código via SDK (`B24OAuth` / `BitrixToken`).

Smoke + SPA:

```
b24_call { method: "app.info" }
b24_call { method: "crm.item.entity-type.list" }
b24_call { method: "crm.item.list", params: { entityTypeId: <id> } }
b24_call { method: "crm.item.fields", params: { entityTypeId: <id> } }
```

Stages **não** usam `crm.stage.list`. Use `crm.status.list` com `filter.ENTITY_ID` (SPA: `DYNAMIC_<entityTypeId>_STAGE_<categoryId>`). Detalhe em [bitrix24-conventions.md](bitrix24-conventions.md).

## Fluxos

**Gerar código de um método** → `b24hub_api_method` (catálogo: params/erros) → `b24hub_sdk_ref` → `b24hub_examples` se precisar de uso real. `field: "markdown"` só se o catálogo não bastar.

**Componente UI** → `b24hub_list({ category: "ui-components", filter: "<prefixo>" })` se o nome for incerto → `b24hub_ui_component`. Tokens/ícones: `b24hub_grep` em `ui/style` ou `ui/icons`. Em UI Kit, leia `ui/components/AGENTS.md`.

**Evento** → `b24hub_api_event` → `b24hub_api_method({ method: "event.bind" })` → `b24hub_examples({ topic: "webhook" })`.

**Python examples** → `b24hub_examples({ topic: "lead", language: "python" })` lê `sdks/python/examples`.

**Inventário SDK** → `b24hub_list({ category: "sdk-services" })` devolve `php/CRM`, `python/crm`, `js/hook`, …

## Resources e prompts

Resources: `b24://skill`, `b24://conventions`, `b24://scopes`, `b24://methods`, `b24://method/{name}`.

Prompts: `spa-discovery`, `event-handler`, `local-app`.

## MCP indisponível

Peça para habilitar o server `b24-dev-hub` em Cursor Settings → Tools & MCP. Não monte URL `https://<portal>/rest/<uid>/<token>/...`.

## Referências (só quando precisar de profundidade)

- Schemas, “quando não usar”, formato de resposta: [mcp-tools-reference.md](mcp-tools-reference.md)
- CRM/SPA, auth, REST v1 vs v3, stages, batch, SDK entry points: [bitrix24-conventions.md](bitrix24-conventions.md)
