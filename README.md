<img src="./b24devhub-header.png" alt="Bitrix24 Developer Hub" width="1195"/>

Welcome to the central hub for Bitrix24 developer tools. This repository aggregates all official SDKs, UI kits, design tokens, examples, application templates, and REST API documentation as **git submodules** — providing a single local reference for development and AI-assisted consultation.

## 🚀 Quick Start

```bash
# Clone with all submodules
git clone --recurse-submodules https://github.com/wondher/bitrix24-dev-hub.git

# If already cloned without submodules
git submodule update --init --recursive

# Update all submodules to latest upstream
./scripts/update-repos.sh
```

## 🤖 AI-Assisted Development

This hub ships with a **local MCP server** (`b24-dev-hub`) that provides intelligent search and retrieval across all resources. It indexes **11,000+ files** from SDKs, UI components, REST API docs, examples, and templates.

### MCP Server Setup

The server is pre-configured in [`.mcp.json`](.mcp.json). To use it with Claude Code:

1. Open this project in Claude Code
2. The MCP server starts automatically — approve it when prompted
3. Run `npm install` inside `mcp-server/` if dependencies are missing

### Available Tools

| Tool | Description |
|------|-------------|
| `b24hub_search` | Universal search across all repos with scope/language filtering |
| `b24hub_get` | Read any file from the hub by path |
| `b24hub_api_method` | Get REST API method documentation (e.g., `crm.lead.add`) |
| `b24hub_api_event` | Get REST API event documentation (e.g., `OnCrmLeadAdd`) |
| `b24hub_sdk_ref` | Get SDK class/method source code (PHP, JS, or Python) |
| `b24hub_ui_component` | Get UI Kit component source and documentation |
| `b24hub_examples` | Find code examples by topic and language |
| `b24hub_list` | List available resources by category (methods, components, etc.) |
| `b24hub_grep` | Search file contents with context lines |

### Standalone Usage

```bash
# Run the MCP server directly
node mcp-server/index.js

# Or install dependencies first
cd mcp-server && npm install && npm start
```

The root [`CLAUDE.md`](CLAUDE.md) provides structured context for AI agents navigating this hub.

## 📚 Table of Contents

- [SDKs and Libraries](#sdks-and-libraries)
  - [PHP SDK](#php-sdk)
  - [JavaScript/Node.js SDK](#javascriptnodejs-sdk)
  - [Python SDK](#python-sdk)
- [UI Tools](#ui-tools)
  - [Bitrix24 UI Kit](#bitrix24-ui-kit)
  - [Design Tokens](#design-tokens)
  - [Icons](#icons)
- [Usage Examples](#usage-examples)
- [Application Templates](#application-templates)
  - [Automation rules library](#automation-rules-library)
- [Documentation](#documentation)
- [Additional Resources](#additional-resources)

## SDKs and Libraries

### PHP SDK

- **b24phpsdk**: The official PHP library for interacting with the Bitrix24 REST API. It supports both OAuth tokens and incoming webhooks, with features like automatic token renewal and offline queues.

  📁 Local: [`sdks/php/`](sdks/php/) · [GitHub Repository](https://github.com/bitrix24/b24phpsdk) · [Documentation](https://apidocs.bitrix24.com/api-reference/b24phpsdk/index.html)

### JavaScript/Node.js SDK

- **b24jssdk**: The official JavaScript SDK for Bitrix24 REST API, compatible with both browser and Node.js environments. It supports modern JavaScript features and offers advantages over the traditional BX24.JS library.

  📁 Local: [`sdks/js/`](sdks/js/) · [GitHub Repository](https://github.com/bitrix24/b24jssdk) · [Documentation](https://bitrix24.github.io/b24jssdk/)

### Python SDK

- **b24pysdk**: The official Python library for interacting with the Bitrix24 REST API (beta version). It supports both OAuth tokens and incoming webhooks, with features like automatic token renewal and batch calls.

  📁 Local: [`sdks/python/`](sdks/python/) · [GitHub Repository](https://github.com/bitrix24/b24pysdk)

## UI Tools

### Bitrix24 UI Kit

- **b24ui**: A UI kit for developing web applications using the Bitrix24 REST API, built on NUXT & VUE. It provides a set of reusable components to accelerate development.

  📁 Local: [`ui/components/`](ui/components/) · [GitHub Repository](https://github.com/bitrix24/b24ui) · [Documentation](https://bitrix24.github.io/b24ui/)

### Design Tokens

- **b24style**: Design tokens for Bitrix24 UI Kit. Provides the ability to create application interfaces that closely match the Bitrix24 user interface using Tailwind CSS utility classes.

  📁 Local: [`ui/style/`](ui/style/) · [GitHub Repository](https://github.com/bitrix24/b24style) · [Documentation](https://bitrix24.github.io/b24style/)

### Icons

- **b24icons**: The library contains SVG icons for use in the interfaces of both local and mass-market applications for Bitrix24.

  📁 Local: [`ui/icons/`](ui/icons/) · [GitHub Repository](https://github.com/bitrix24/b24icons) · [Documentation](https://bitrix24.github.io/b24icons/)

## Usage Examples

- **b24sdk-examples**: A collection of examples demonstrating the usage of various Bitrix24 SDKs and tools in real-world scenarios.

  📁 Local: [`examples/sdk-examples/`](examples/sdk-examples/) · [GitHub Repository](https://github.com/bitrix24/b24sdk-examples) · [Documentation](https://bitrix24.github.io/b24ui/)

## Application Templates

Ready-to-use application templates that can be deployed quickly using Docker. These templates provide a foundation for building custom business logic on top of Bitrix24.

### Automation rules library

[This project](https://github.com/bitrix24/app-template-automation-rules) is a fully deployable application template featuring a library of Bitrix24 automation rules. It's designed to work both as a local solution and as a scalable application for the Bitrix24 Marketplace.

You're getting a complete package here: the frontend is built with the UI Kit and B24JsSDK, while the backend is set up so you can simply add your own automation rule implementations without having to dig into architectural complexities. No need to reinvent the wheel — just take the foundation and customize it to fit your needs.

  📁 Local: [`examples/app-template-automation/`](examples/app-template-automation/) · [GitHub Repository](https://github.com/bitrix24/app-template-automation-rules)

## Documentation

- **b24restdocs**: The official repository for Bitrix24 REST API documentation, offering comprehensive guides and references for developers.

  📁 Local: [`docs/rest-api/`](docs/rest-api/) · [GitHub Repository](https://github.com/bitrix24/b24restdocs) · [Online version](https://apidocs.bitrix24.com/)

## Additional Resources

- **crest**: CRest is a minimalistic PHP library for calling Bitrix24 REST methods via webhooks and OAuth 2.0.

  📁 Local: [`tools/crest/`](tools/crest/) · [GitHub Repository](https://github.com/bitrix-tools/crest)

---

This hub aims to simplify navigation through Bitrix24's development tools, enabling you to build robust integrations and applications efficiently.
