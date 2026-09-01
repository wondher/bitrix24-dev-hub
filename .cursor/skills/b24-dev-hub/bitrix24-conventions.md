# Convenções Bitrix24 (para acertar código de primeira)

Combine com as tools: `b24hub_api_method` para assinatura, `b24_call` para o portal, `b24hub_search` para aprofundar.

---

## 1. Entidades CRM

| Entidade | REST legado | Universal (SPA) | Uso |
|---|---|---|---|
| Lead | `crm.lead.*` | `crm.item.*` | Captação |
| Deal | `crm.deal.*` | `crm.item.*` | Pipeline de vendas |
| Contact | `crm.contact.*` | `crm.item.*` | Pessoa física |
| Company | `crm.company.*` | `crm.item.*` | Pessoa jurídica |
| Requisite | `crm.requisite.*` | — | CNPJ/CPF, endereço |

Campos padrão (`TITLE`, `NAME`, `PHONE`, `EMAIL`, `ASSIGNED_BY_ID`) + custom `UF_CRM_*`. Descobrir:

```
b24_call { method: "crm.lead.fields" }
b24_call { method: "crm.item.fields", params: { entityTypeId: 152 } }
```

---

## 2. SPA / Smart Processes

Cada SPA tem `entityTypeId` numérico, **por portal**.

| entityTypeId | Comum |
|---|---|
| 1 | Lead |
| 2 | Deal |
| 3 | Contact |
| 4 | Company |
| 7 | Requisite |
| 152+ | SPA custom — **não copie ID de tutorial** |

```
b24_call { method: "crm.item.entity-type.list" }
```

`crm.item.*` vale para qualquer entidade CRM (passe `entityTypeId`). Legado (`crm.lead.add`) ainda funciona nas entidades padrão. SPA custom → sempre `crm.item.*`.

---

## 3. Auth: webhook inbound vs OAuth

**Webhook inbound** (o que `b24_call` faz): token estático na URL, criado em Desenvolvedor → Outro → Webhook de entrada. Permissões = usuário criador. Server-to-server interno.

**OAuth 2.0** (apps Marketplace / multi-tenant): `client_id` / `client_secret`, Authorization Code. `b24_call` **não** cobre. Gere via SDK: `b24hub_sdk_ref({ name: "B24OAuth", sdk: "js" })` ou `BitrixToken` no Python.

---

## 4. REST v1 vs v3

| | v1 | v3 |
|---|---|---|
| Endpoint | `/rest/<uid>/<token>/<method>.json` | `/rest/api/<resource>` |
| Spec | markdown no hub (catálogo via `b24hub_api_method`) | OpenAPI (`docs/rest-api/api-reference/rest-v3.md`) |
| `b24_call` | sim | não |

A MCP oficial ([apidocs MCP](https://apidocs.bitrix24.com/ai-tools/mcp.html), `b24-dev-mcp` 0.2.0) é **só documentação** (`bitrix-search`, `bitrix-method-details`, …). Não chama o portal. O diferencial deste hub é `b24_call` no REST v1 (webhook inbound). OAuth e REST v3 no live call ficam de fora até o produto ir a público.

A maioria das integrações ainda é v1. Confirme o método com `b24hub_api_method` (catálogo) antes de `b24_call`.

---

## 5. Scopes

OAuth declara scopes (`crm`, `task`, `user`, `im`, `disk`). Webhook inbound herda o usuário — sem lista explícita.

```
b24hub_list { category: "sdk-scopes" }
b24hub_get { path: "docs/rest-api/api-reference/scopes/permissions.md" }
```

`sdk-scopes` devolve os códigos da tabela em `permissions.md` (`crm`, `task`, `user`, `sonet_group`, `socialnetwork`, …).

---

## 6. Eventos

Padrão `On<Entity><Action>`: `OnCrmLeadAdd`, `OnCrmDealDelete`, `OnTaskAdd`.

- `event.bind` / `event.unbind` — registrar/remover handler HTTP
- `event.offline.get` / `event.offline.done` — fila persistida (melhor em produção)

Online = POST imediato. Offline = você puxa a fila.

---

## 7. Stages

`crm.stage.list` **não existe** (`ERROR_METHOD_NOT_FOUND`). Use `crm.status.list`:

```
b24_call { method: "crm.status.list", params: { filter: { ENTITY_ID: "<código>" }, order: { SORT: "ASC" } } }
```

| Entidade | ENTITY_ID |
|---|---|
| Lead | `STATUS` |
| Deal (direção default) | `DEAL_STAGE` |
| Deal (outra direção) | `DEAL_STAGE_<dirId>` |
| Quote | `QUOTE_STATUS` |
| SPA | `DYNAMIC_<entityTypeId>_STAGE_<categoryId>` |

SPA 152, direção 0 → `DYNAMIC_152_STAGE_0`.

`EXTRA.SEMANTICS`: `process` \| `success` \| `failure`.

Tutorial: `b24hub_get({ path: "docs/rest-api/tutorials/crm/how-to-get-lists/how-to-get-stages-with-semantics.md" })`.

---

## 8. Batch

Até 50 comandos numa HTTP. `halt: 0` continua no erro; `halt: 1` para. `cmd` é mapa `chave → "method?query=params"`. Encadeamento: `{{chave.campo}}`.

```
b24hub_examples { topic: "batch", language: "php" }
b24hub_grep { pattern: "->batch(", directory: "sdks/php" }
```

---

## 9. SDK entry points

**PHP** `@bitrix24/b24phpsdk` — `ServiceBuilderFactory::createServiceBuilder(...)` → `$builder->getCRMScope()->Lead()->add([...])`.

**JS** `@bitrix24/b24jssdk` — `initializeB24Frame()` (iframe), `B24Hook` (webhook), `B24OAuth` (OAuth).

**Python** `b24pysdk` — `Client(BitrixWebhook(b24_url, user_id, token))` → `client.call_method(...)`.

**CRest** `tools/crest` — `CRest::call('crm.lead.add', [...])`.

```
b24hub_sdk_ref { name: "ServiceBuilderFactory", sdk: "php" }
b24hub_sdk_ref { name: "B24Hook", sdk: "js" }
b24hub_sdk_ref { name: "Client", sdk: "python" }
```

---

## 10. UI Kit

`@bitrix24/b24ui-nuxt` — Vue 3 + Nuxt + Reka UI + Tailwind. Prefixo `<B24Xxx>`. Cores **semânticas** `b24-*`, nunca hex. Tokens: `@bitrix24/b24style`. Ícones: `@bitrix24/b24icons`.

---

## 11. Sequência típica

1. Domínio — este doc + `b24hub_search`
2. Assinatura — `b24hub_api_method`
3. Referência — `b24hub_sdk_ref` ou `b24hub_examples`
4. Portal — `b24_call` (leitura; mutação só se pedida **e** com `confirm: true`)
5. Código — webhook inbound interno; OAuth se for app público

`.b24.config.json` tem credencial real. Confirme `git check-ignore .b24.config.json` antes de commit. Nunca exponha o token.
