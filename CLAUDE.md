# CLAUDE.md — Bitrix24 Developer Hub

## Purpose

This repository is a **local development hub** for Bitrix24 platform development. It aggregates all official SDKs, UI tools, REST API documentation, examples, and application templates as git submodules for AI-assisted consultation.

## Repository Structure

```
bitrix24-dev-hub/
├── sdks/
│   ├── php/          ← b24phpsdk (PHP SDK)
│   ├── js/           ← b24jssdk (JS/TS SDK)
│   └── python/       ← b24pysdk (Python SDK)
├── ui/
│   ├── components/   ← b24ui (UI Kit - Vue/Nuxt)
│   ├── style/        ← b24style (Design Tokens - Tailwind)
│   └── icons/        ← b24icons (SVG Icons)
├── docs/
│   └── rest-api/     ← b24restdocs (REST API Documentation)
├── examples/
│   ├── sdk-examples/           ← b24sdk-examples
│   └── app-template-automation/ ← app-template-automation-rules
└── tools/
    └── crest/                   ← CRest PHP library
```

## Quick Navigation by Task

| Task | Primary Path | Supporting Paths |
|------|-------------|-----------------|
| Build a PHP integration | `sdks/php/` | `tools/crest/`, `docs/rest-api/` |
| Build a JS/Vue/Nuxt app | `sdks/js/`, `ui/components/` | `ui/style/`, `ui/icons/` |
| Build a Python script | `sdks/python/` | `docs/rest-api/` |
| Create a full-stack app | `examples/app-template-automation/` | `sdks/php/`, `sdks/js/` |
| Look up a REST API method | `docs/rest-api/api-reference/` | — |
| Follow a tutorial | `docs/rest-api/tutorials/` | `docs/rest-api/first-steps/` |
| Find code examples | `examples/sdk-examples/` | — |
| Style a Bitrix24 app | `ui/style/` | `ui/components/`, `ui/icons/` |
| Use icons in an app | `ui/icons/` | `ui/components/` |
| Publish to Marketplace | `docs/rest-api/market/` | `examples/app-template-automation/` |

## Authentication Overview

Bitrix24 REST API supports three integration scenarios:
1. **Incoming Webhooks** — for single-account integrations (no OAuth needed)
2. **Local Applications** — installed on a specific Bitrix24 portal
3. **Public Applications (OAuth 2.0)** — for mass-market Marketplace apps

All SDKs support webhook and OAuth authentication.

## SDK Quick Reference

### PHP SDK (`sdks/php/`)
- **Version**: 1.10.* | PHP 8.2+
- **Entry Point**: `ServiceBuilderFactory`
- **Auth**: Webhook or `ApplicationProfile` (OAuth)
- **Architecture**: `Core\ApiClient` → `Services\*` (scope-based services)
- **Key Features**: Batch operations with PHP generators (constant memory), typed results, auto token renewal, Symfony HttpClient
- **Key Paths**: `src/`, `examples/webhook/`, `examples/local-app/`, `tests/`
- **Note**: v3 branch available for PHP 8.4+ with breaking changes

### JavaScript SDK (`sdks/js/`)
- **Package**: `@bitrix24/b24jssdk`
- **Language**: TypeScript
- **Entry Points**:
  - `initializeB24Frame()` — iframe apps embedded in Bitrix24
  - `B24Hook` — webhook-based integrations
  - `B24OAuth` — OAuth 2.0 applications
- **Runtime**: Browser (ESM/UMD) and Node.js
- **Key Paths**: `packages/`, `docs/`, `playgrounds/`, `test/`

### Python SDK (`sdks/python/`)
- **Package**: `b24pysdk` (PyPI)
- **Python**: 3.9+
- **Entry Point**: `Client` class
- **Auth**: `BitrixWebhook` or `BitrixToken` (OAuth)
- **Modules**: CRM, User, Department, SocialNetwork
- **Key Features**: Batch operations, event subscriptions, Docker-based dev environment
- **Key Paths**: `src/b24pysdk/`, `tests/`, `docs/`

## UI Tools

### UI Kit (`ui/components/`)
- **Framework**: Vue 3 / Nuxt (Reka UI + Tailwind CSS)
- **npm**: `@bitrix24/b24ui-nuxt`
- **Key Paths**: `src/runtime/components/`, `src/theme/`, `docs/content/docs/2.components/`
- **CLI**: `bitrix24-ui make component` for scaffolding
- **Important**: Has its own `AGENTS.md` with detailed AI guidance — **read it when working with UI components**

### Design Tokens (`ui/style/`)
- **Framework**: Tailwind CSS plugin
- **npm**: `@bitrix24/b24style`
- **Purpose**: Create app interfaces matching Bitrix24 UI using Tailwind utility classes
- **Requires**: Node.js 18+, Tailwind CSS 3.4.10+

### Icons (`ui/icons/`)
- **Format**: SVG icons for Bitrix24 app interfaces
- **Available as**: Vue components, React components, SVG sprites

## REST API Documentation (`docs/rest-api/`)
Official Bitrix24 REST API docs. Key sections:

| Section | Path | Content |
|---------|------|---------|
| API Reference | `api-reference/` | All REST method documentation |
| Getting Started | `first-steps/` | Setup and basics |
| Tutorials | `tutorials/` | Step-by-step guides |
| SDK Docs | `sdk/` | SDK-specific documentation |
| Extensions | `extensions/` | Bitrix24 extension docs |
| Marketplace | `market/` | Publishing apps |
| Local Integrations | `local-integrations/` | On-premise integrations |
| AI Tools | `ai-tools/` | AI-related API features |

Online version: https://apidocs.bitrix24.com/

## App Template (`examples/app-template-automation/`)
Full-stack Docker-based template for Bitrix24 Marketplace apps:
- **Frontend**: Nuxt 3 + b24ui + b24jssdk
- **Backend**: RabbitMQ consumers (Node.js + PHP)
- **Database**: PostgreSQL (Prisma ORM)
- **Key Paths**: `frontend/`, `consumers/`, `docker-compose.*.yml`

## CRest (`tools/crest/`)
Minimalistic PHP library for Bitrix24 REST API calls:
- **Entry Point**: `CRest::call()`
- **Auth**: Webhooks, local apps, public apps
- **Key Path**: `src/crest.php`

## Important Conventions
- All repos use **MIT license**
- b24phpsdk and b24ui use **conventional commits**
- b24ui requires **semantic color names** (not arbitrary values)
- b24pysdk uses **Docker-only** development environment
- REST API endpoint pattern: `{portal}/rest/{user_id}/{token}/{method}`
- When working with b24ui, always read `ui/components/AGENTS.md` first
