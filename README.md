# wappmcp

[![npm version](https://img.shields.io/npm/v/wappmcp)](https://www.npmjs.com/package/wappmcp)
[![Publish to NPM](https://github.com/vaibhavpandeyvpz/wappmcp/actions/workflows/publish-npm.yml/badge.svg)](https://github.com/vaibhavpandeyvpz/wappmcp/actions/workflows/publish-npm.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`wappmcp` is an open-source WhatsApp Web CLI and stdio MCP server built on top of `whatsapp-web.js`, `commander`, and `@modelcontextprotocol/sdk`.

It lets MCP-compatible clients read WhatsApp data, send and manage messages, and optionally subscribe to incoming WhatsApp events through an MCP notification channel.

## Highlights

- Exposes WhatsApp as an MCP server over stdio.
- Supports interactive configuration via `wappmcp configure`.
- Provides read tools for chats, contacts, messages, status, and account details.
- Includes mutating tools for sending, replying, reacting, editing, deleting, forwarding, and typing.
- Can emit incoming message events over an optional MCP notification channel.
- Stores local app data under `~/.wappmcp/`.

## Requirements

- Node.js `24+`
- A local Chrome or Chromium installation that `puppeteer` can launch

If browser auto-detection does not work in your environment, set either `WAPPMCP_BROWSER_PATH` or `PUPPETEER_EXECUTABLE_PATH`.

## Installation

Use it without installing globally:

```bash
npx wappmcp configure
```

Or with Bun:

```bash
bunx wappmcp configure
```

If you prefer a global install:

```bash
npm install -g wappmcp
```

For local development:

```bash
npm install
npm run build
npm run dev -- configure
```

## Quick Start

1. Run the interactive configuration:

```bash
npx wappmcp configure
```

This lets you:

- connect WhatsApp (including QR scan when required)
- disconnect and remove local session data
- manage `allowlist.users` and `allowlist.chats`

Configuration is saved to:

```text
~/.wappmcp/config.json
```

2. Start the MCP server:

```bash
npx wappmcp mcp
```

3. If your MCP host supports notifications and you want incoming WhatsApp events, enable channels:

```bash
npx wappmcp mcp --channels
```

The server uses stdio, so it is meant to be launched by an MCP client or wrapper rather than browsed directly in a terminal.

## CLI Usage

### Configure

```bash
npx wappmcp configure
bunx wappmcp configure
```

Opens an interactive configure UI (Ink) to manage WhatsApp connection and event allowlist:

- connect/disconnect session
- `Allowed users`
- `Allowed chats`

Allowed users/chats screens support live type-to-filter search. Large lists are shown in a 5-row scroll viewport, with `Back` kept as a persistent utility row.

Everything is persisted to:

```text
~/.wappmcp/config.json
```

Session data always lives at:

```text
~/.wappmcp/profile
```

### MCP Server

```bash
npx wappmcp mcp
bunx wappmcp mcp
```

Starts the stdio MCP server for the configured WhatsApp session.

Optional channel support:

```bash
npx wappmcp mcp --channels
```

## MCP Tools

The server currently exposes these tools:

- `whatsapp_get_me`
- `whatsapp_get_status`
- `whatsapp_list_chats`
- `whatsapp_get_chat`
- `whatsapp_get_chat_participants`
- `whatsapp_get_chat_messages`
- `whatsapp_search_messages`
- `whatsapp_get_message`
- `whatsapp_list_contacts`
- `whatsapp_get_contact`
- `whatsapp_search_contacts`
- `whatsapp_get_contact_lid`
- `whatsapp_lookup_number`
- `whatsapp_send_message`
- `whatsapp_send_media_from_base64`
- `whatsapp_send_media_from_path`
- `whatsapp_reply_to_message`
- `whatsapp_react_to_message`
- `whatsapp_edit_message`
- `whatsapp_delete_message`
- `whatsapp_forward_message`
- `whatsapp_send_typing`

## Push Channel

When started with `--channels`, the server:

- advertises the experimental MCP capability `hooman/channel`
- advertises `hooman/user` with path `meta.user`
- advertises `hooman/session` with path `meta.session`
- advertises `hooman/thread` with path `meta.thread`
- advertises `hooman/channel/permission` for remote daemon approvals
- emits `notifications/hooman/channel` for incoming WhatsApp `message` events

If allowlist entries are configured, `notifications/hooman/channel` events are emitted only when either:

- `meta.session` (chat ID) is in `allowlist.chats`, or
- `meta.user` (sender ID) is in `allowlist.users`

When no allowlist is configured (or both arrays are empty), all inbound channel events are emitted.

Each notification includes:

- `content`: a JSON-encoded event payload
- `meta.source`: always `whatsapp`
- `meta.user`: the sender identity seed for the incoming message
- `meta.session`: the chat identity seed for the incoming message
- `meta.thread`: the WhatsApp message ID for the incoming message

The JSON-decoded `content` payload includes:

- `source`
- `self`
- `message`
- `text`

If the incoming message or its quoted parent contains media, attachments are downloaded and included in the emitted event payload. Files are stored under `~/.wappmcp/attachments/`.

When Hooman sends `notifications/hooman/channel/permission_request`, `wappmcp` posts the request back into the originating WhatsApp chat and waits for a reply to that exact message. Supported replies are `yes`, `always`, and `no`, which are relayed back over `notifications/hooman/channel/permission`.

## Local Data

`wappmcp` stores local state under `~/.wappmcp/`:

- `profile/` for WhatsApp session data
- `config.json` for allowlist configuration
- `attachments/` for downloaded incoming media attachments
- `.wwebjs_cache/` for WhatsApp Web version cache data

## Notes

- This project uses WhatsApp Web under the hood, so the first login must be completed by scanning a QR code.
- Some device metadata is unavailable on multi-device sessions.
- Incoming notification channels depend on MCP host support.

## License

MIT. See [LICENSE](LICENSE).
