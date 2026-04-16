# wappmcp

[![npm version](https://img.shields.io/npm/v/wappmcp)](https://www.npmjs.com/package/wappmcp)
[![Publish to NPM](https://github.com/vaibhavpandeyvpz/wappmcp/actions/workflows/publish-npm.yml/badge.svg)](https://github.com/vaibhavpandeyvpz/wappmcp/actions/workflows/publish-npm.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`wappmcp` is an open-source WhatsApp Web CLI and stdio MCP server built on top of `whatsapp-web.js`, `commander`, and `@modelcontextprotocol/sdk`.

It lets MCP-compatible clients read WhatsApp data, send and manage messages, and optionally subscribe to incoming WhatsApp events through an MCP notification channel.

## Highlights

- Exposes WhatsApp as an MCP server over stdio.
- Supports multiple local profiles.
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
npx wappmcp profiles
```

Or with Bun:

```bash
bunx wappmcp profiles
```

If you prefer a global install:

```bash
npm install -g wappmcp
```

For local development:

```bash
npm install
npm run build
npm run dev -- profiles
```

## Quick Start

1. Connect a profile and scan the QR code:

```bash
npx wappmcp connect --profile personal
```

2. Start the MCP server for that profile:

```bash
npx wappmcp mcp --profile personal
```

3. If your MCP host supports notifications and you want incoming WhatsApp events, provide a channel name:

```bash
npx wappmcp mcp --profile personal --channel claude/channel
```

The server uses stdio, so it is meant to be launched by an MCP client or wrapper rather than browsed directly in a terminal.

## CLI Usage

### Connect

```bash
npx wappmcp connect --profile sales
bunx wappmcp connect --profile sales
```

Starts WhatsApp for the profile, prints a QR code when needed, waits for the account to become ready, then exits.

### MCP Server

```bash
npx wappmcp mcp --profile sales
bunx wappmcp mcp --profile sales
```

Starts the stdio MCP server for a connected profile.

Optional channel support:

```bash
npx wappmcp mcp --profile sales --channel claude/channel
```

### Disconnect

```bash
npx wappmcp disconnect --profile sales
bunx wappmcp disconnect --profile sales
```

Starts the client, logs out if an active session exists, closes the client, deletes the stored local profile data, and exits.

### List Profiles

```bash
npx wappmcp profiles
bunx wappmcp profiles
```

Lists locally stored profiles.

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

When started with `--channel <name>`, the server:

- advertises the experimental MCP capability `<name>`
- emits `notifications/<name>` for incoming WhatsApp `message` events

The event payload includes:

- `source`
- `self`
- `message`
- `text`

If the incoming message or its quoted parent contains media, attachments are downloaded and included in the emitted event payload. Files are stored under `~/.wappmcp/attachments/`.

## Local Data

`wappmcp` stores local state under `~/.wappmcp/`:

- `profiles/` for WhatsApp profile/session data
- `attachments/` for downloaded incoming media attachments
- `.wwebjs_cache/` for WhatsApp Web version cache data

## Notes

- This project uses WhatsApp Web under the hood, so the first login must be completed by scanning a QR code.
- Some device metadata is unavailable on multi-device sessions.
- Incoming notification channels depend on MCP host support.

## License

MIT. See [LICENSE](LICENSE).
