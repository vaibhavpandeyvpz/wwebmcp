import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { createJsonResult } from "./helpers.js";
import { packageMetadata } from "../package-metadata.js";
import { WhatsAppChannel } from "../whatsapp/channel.js";
import type { WhatsAppSession } from "../whatsapp/session.js";

const HOOMAN_CHANNEL = "hooman/channel";
const HOOMAN_CHANNEL_PERMISSION = "hooman/channel/permission";
const HOOMAN_PERMISSION_REQUEST_METHOD =
  "notifications/hooman/channel/permission_request";

function instructions(channel: boolean = false): string {
  const files = ["formatting.md", channel ? "channel.md" : null].filter(
    Boolean,
  );
  const root = dirname(fileURLToPath(import.meta.url));
  const sections = files.map((file) =>
    readFileSync(resolve(root, `../../prompts/${file}`), "utf8").trim(),
  );
  return `${sections.join("\n\n").trim()}\n`;
}

export class WhatsAppMcpServer {
  readonly mcp: McpServer;
  private readonly permissionRequestsByPromptMessageId = new Map<
    string,
    string
  >();

  private constructor(
    private readonly session: WhatsAppSession,
    private readonly channels: boolean,
  ) {
    this.mcp = new McpServer(
      {
        name: packageMetadata.name,
        version: packageMetadata.version,
      },
      {
        capabilities: {
          experimental: channels
            ? {
                "hooman/user": { path: "meta.user" },
                "hooman/session": { path: "meta.session" },
                "hooman/thread": { path: "meta.thread" },
                [HOOMAN_CHANNEL]: {},
                [HOOMAN_CHANNEL_PERMISSION]: {},
              }
            : undefined,
        },
        instructions: instructions(channels),
      },
    );
    if (channels) {
      this.registerPermissionRelay();
    }
  }

  static create(
    session: WhatsAppSession,
    channels: boolean,
  ): WhatsAppMcpServer {
    const server = new WhatsAppMcpServer(session, channels);
    server.registerTools();
    return server;
  }

  async start(transport: Transport): Promise<void> {
    await this.mcp.connect(transport);
  }

  async subscribe() {
    if (!this.channels) {
      throw new Error("Channels are not enabled");
    }

    const channel = new WhatsAppChannel(
      this.session,
      this.mcp.server,
      HOOMAN_CHANNEL,
      this.permissionRequestsByPromptMessageId,
    );
    await channel.start();
  }

  private registerTools(): void {
    this.mcp.registerTool(
      "whatsapp_get_me",
      {
        title: "Get connected WhatsApp user",
        description:
          "Return the current session details for the connected WhatsApp user.",
      },
      async () => createJsonResult(await this.session.getMe()),
    );

    this.mcp.registerTool(
      "whatsapp_get_status",
      {
        title: "Get WhatsApp connection status",
        description:
          "Return the current connection status for this WhatsApp profile.",
      },
      async () => createJsonResult(await this.session.getStatus()),
    );

    this.mcp.registerTool(
      "whatsapp_list_chats",
      {
        title: "List WhatsApp chats",
        description:
          "List all chats available in the connected WhatsApp account.",
      },
      async () => createJsonResult(await this.session.listChats()),
    );

    this.mcp.registerTool(
      "whatsapp_get_chat",
      {
        title: "Get WhatsApp chat",
        description:
          "Get details for a chat by ID, including participants for groups.",
        inputSchema: z.object({
          chatId: z.string().describe("Target chat ID."),
        }),
      },
      async ({ chatId }) =>
        createJsonResult(await this.session.getChatInfo(chatId)),
    );

    this.mcp.registerTool(
      "whatsapp_get_chat_participants",
      {
        title: "Get WhatsApp chat participants",
        description:
          "List participants in a group chat. Returns an empty list for non-group chats.",
        inputSchema: z.object({
          chatId: z.string().describe("Target chat ID."),
        }),
      },
      async ({ chatId }) =>
        createJsonResult(await this.session.getChatParticipants(chatId)),
    );

    this.mcp.registerTool(
      "whatsapp_get_chat_messages",
      {
        title: "Get WhatsApp chat messages",
        description: "Fetch recent messages from a chat for context.",
        inputSchema: z.object({
          chatId: z.string().describe("Target chat ID."),
          limit: z.number().int().positive().max(100).optional(),
        }),
      },
      async ({ chatId, limit }) =>
        createJsonResult(await this.session.getChatMessages(chatId, limit)),
    );

    this.mcp.registerTool(
      "whatsapp_search_messages",
      {
        title: "Search WhatsApp messages",
        description:
          "Search messages globally or within a chat using query and optional chatId, page, and limit parameters.",
        inputSchema: z.object({
          query: z.string().describe("Search query."),
          chatId: z.string().optional().describe("Optional chat ID scope."),
          page: z.number().int().positive().optional(),
          limit: z.number().int().positive().optional(),
        }),
      },
      async ({ query, chatId, page, limit }) =>
        createJsonResult(
          await this.session.searchMessages(query, chatId, page, limit),
        ),
    );

    this.mcp.registerTool(
      "whatsapp_get_message",
      {
        title: "Get WhatsApp message",
        description: "Get a message snapshot by message ID.",
        inputSchema: z.object({
          messageId: z.string().describe("Target message ID."),
        }),
      },
      async ({ messageId }) =>
        createJsonResult(await this.session.getMessage(messageId)),
    );

    this.mcp.registerTool(
      "whatsapp_list_contacts",
      {
        title: "List WhatsApp contacts",
        description:
          "List all contacts available in the connected WhatsApp account.",
      },
      async () => createJsonResult(await this.session.listContacts()),
    );

    this.mcp.registerTool(
      "whatsapp_get_contact",
      {
        title: "Get WhatsApp contact",
        description: "Get details for a specific contact by contact ID.",
        inputSchema: z.object({
          contactId: z.string().describe("Target contact ID."),
        }),
      },
      async ({ contactId }) =>
        createJsonResult(await this.session.getContactInfo(contactId)),
    );

    this.mcp.registerTool(
      "whatsapp_search_contacts",
      {
        title: "Search WhatsApp contacts",
        description:
          "Search contacts by name, pushname, short name, number, or ID using query and optional limit parameters.",
        inputSchema: z.object({
          query: z.string().describe("Search query."),
          limit: z.number().int().positive().max(50).optional(),
        }),
      },
      async ({ query, limit }) =>
        createJsonResult(await this.session.searchContacts(query, limit)),
    );

    this.mcp.registerTool(
      "whatsapp_get_contact_lid",
      {
        title: "Get WhatsApp contact LID",
        description:
          "Return the LID mapping for a contact ID, when available from the current client.",
        inputSchema: z.object({
          contactId: z.string().describe("Target contact ID."),
        }),
      },
      async ({ contactId }) =>
        createJsonResult({
          lid: await this.session.getLidForContact(contactId),
        }),
    );

    this.mcp.registerTool(
      "whatsapp_lookup_number",
      {
        title: "Lookup WhatsApp number",
        description:
          "Look up whether a number is registered on WhatsApp and return normalized metadata for it.",
        inputSchema: z.object({
          number: z
            .string()
            .describe("Phone number or WhatsApp number to look up."),
        }),
      },
      async ({ number }) =>
        createJsonResult(await this.session.lookupNumber(number)),
    );

    this.mcp.registerTool(
      "whatsapp_send_message",
      {
        title: "Send a WhatsApp message",
        description: "Send a plain text message to a WhatsApp chat or group.",
        inputSchema: z.object({
          chatId: z.string().describe("Target chat ID."),
          text: z.string().describe("Message text."),
        }),
      },
      async ({ chatId, text }) => {
        const messageId = await this.session.sendMessage(chatId, text);
        return createJsonResult({ messageId });
      },
    );

    this.mcp.registerTool(
      "whatsapp_send_media_from_base64",
      {
        title: "Send WhatsApp media from base64",
        description:
          "Send media to a WhatsApp chat using a base64 payload plus MIME type and optional filename/caption.",
        inputSchema: z.object({
          chatId: z.string(),
          data: z.string().describe("Base64-encoded file content."),
          mimetype: z
            .string()
            .describe("MIME type, for example image/png or application/pdf."),
          filename: z.string().optional(),
          caption: z.string().optional(),
        }),
      },
      async ({ chatId, data, mimetype, filename, caption }) => {
        const messageId = await this.session.sendMediaFromBase64(
          chatId,
          mimetype,
          data,
          filename,
          caption,
        );
        return createJsonResult({ messageId });
      },
    );

    this.mcp.registerTool(
      "whatsapp_send_media_from_path",
      {
        title: "Send WhatsApp media from path",
        description: "Send a local file to a WhatsApp chat by file path.",
        inputSchema: z.object({
          chatId: z.string(),
          path: z.string().describe("Absolute or relative local file path."),
          caption: z.string().optional(),
        }),
      },
      async ({ chatId, path, caption }) => {
        const messageId = await this.session.sendMediaFromPath(
          chatId,
          path,
          caption,
        );
        return createJsonResult({ messageId });
      },
    );

    this.mcp.registerTool(
      "whatsapp_reply_to_message",
      {
        title: "Reply to a WhatsApp message",
        description: "Send a quoted reply to an existing WhatsApp message.",
        inputSchema: z.object({
          messageId: z.string().describe("Message ID to reply to."),
          text: z.string().describe("Reply text."),
          chatId: z.string().optional().describe("Optional chat ID override."),
        }),
      },
      async ({ messageId, text, chatId }) => {
        const newMessageId = await this.session.replyToMessage(
          messageId,
          text,
          chatId,
        );
        return createJsonResult({ messageId: newMessageId });
      },
    );

    this.mcp.registerTool(
      "whatsapp_react_to_message",
      {
        title: "React to a WhatsApp message",
        description: "Add an emoji reaction to an existing WhatsApp message.",
        inputSchema: z.object({
          messageId: z.string().describe("Target message ID."),
          emoji: z
            .string()
            .optional()
            .describe("Emoji reaction. Default is thumbs up."),
        }),
      },
      async ({ messageId, emoji }) => {
        await this.session.reactToMessage(messageId, emoji ?? "👍");
        return createJsonResult({ ok: true });
      },
    );

    this.mcp.registerTool(
      "whatsapp_edit_message",
      {
        title: "Edit a WhatsApp message",
        description: "Edit a previously sent message by ID.",
        inputSchema: z.object({
          messageId: z.string().describe("Target message ID."),
          text: z.string().describe("Updated message text."),
        }),
      },
      async ({ messageId, text }) => {
        await this.session.editMessage(messageId, text);
        return createJsonResult({ ok: true });
      },
    );

    this.mcp.registerTool(
      "whatsapp_delete_message",
      {
        title: "Delete a WhatsApp message",
        description:
          "Delete a message by ID. Use everyone=true to try deleting for everyone when supported.",
        inputSchema: z.object({
          messageId: z.string().describe("Target message ID."),
          everyone: z
            .boolean()
            .optional()
            .describe("Whether to delete the message for everyone."),
        }),
      },
      async ({ messageId, everyone }) => {
        await this.session.deleteMessage(messageId, everyone ?? false);
        return createJsonResult({ ok: true });
      },
    );

    this.mcp.registerTool(
      "whatsapp_forward_message",
      {
        title: "Forward a WhatsApp message",
        description: "Forward an existing message to another chat.",
        inputSchema: z.object({
          messageId: z.string().describe("Source message ID."),
          chatId: z.string().describe("Destination chat ID."),
        }),
      },
      async ({ messageId, chatId }) => {
        await this.session.forwardMessage(chatId, messageId);
        return createJsonResult({ ok: true });
      },
    );

    this.mcp.registerTool(
      "whatsapp_send_typing",
      {
        title: "Show WhatsApp typing state",
        description: "Show the typing indicator in a target chat.",
        inputSchema: z.object({
          chatId: z.string().describe("Target chat ID."),
        }),
      },
      async ({ chatId }) => {
        await this.session.sendTyping(chatId);
        return createJsonResult({ ok: true });
      },
    );
  }

  private registerPermissionRelay(): void {
    const schema = z.object({
      method: z.literal(HOOMAN_PERMISSION_REQUEST_METHOD),
      params: z.object({
        request_id: z.string().min(1),
        tool_name: z.string().min(1),
        description: z.string().min(1),
        input_preview: z.string().min(1),
        meta: z
          .object({
            source: z.string().optional(),
            user: z.string().optional(),
            session: z.string().optional(),
            thread: z.string().optional(),
          })
          .optional(),
      }),
    });
    this.mcp.server.setNotificationHandler(
      schema,
      async ({ params }: z.infer<typeof schema>) => {
        const chatId = params.meta?.session?.trim();
        if (!chatId) {
          return;
        }
        const text = [
          `I want to run ${params.tool_name}.`,
          `Description: ${params.description}`,
          `Input: ${params.input_preview}`,
          "",
          'Reply to this message with "yes", "always", or "no".',
        ].join("\n");
        const messageId = params.meta?.thread?.trim();
        let promptMessageId: string;
        if (messageId) {
          promptMessageId = await this.session.replyToMessage(
            messageId,
            text,
            chatId,
          );
        } else {
          promptMessageId = await this.session.sendMessage(chatId, text);
        }
        this.permissionRequestsByPromptMessageId.set(
          promptMessageId,
          params.request_id,
        );
      },
    );
  }
}
