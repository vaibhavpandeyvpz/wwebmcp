import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { WhatsAppEventAllowlist } from "./config.js";
import type { WhatsAppSession } from "./session.js";
import type {
  ChannelPermissionBehavior,
  Entity,
  Message,
  MessageWithParent,
  WwebMessage,
} from "./types.js";
import { saveMessageMedia } from "../attachments.js";

export interface MessageChannelEvent {
  source: "whatsapp";
  self: Entity;
  message: Message | MessageWithParent;
  text: string;
}

/**
 * Bridges the WhatsApp `message` (incoming-only) event stream to MCP channel
 * notifications. Owns the listener lifecycle: call {@link start} after the
 * MCP transport is connected and the returned unsubscribe runs automatically
 * when the underlying `Server` closes.
 */
export class WhatsAppChannel {
  private unsubscribe?: () => void;
  private self?: Entity;

  constructor(
    private readonly session: WhatsAppSession,
    private readonly mcp: Server,
    private readonly channel: string,
    private readonly permissionRequests: Map<string, string>,
    private readonly allowlist?: WhatsAppEventAllowlist,
  ) {}

  async start(): Promise<void> {
    this.self = await this.session.getMe();

    const onMessage = (message: WwebMessage) => {
      void (async () => {
        try {
          const verdict = await this.parsePermissionVerdict(message);
          if (verdict) {
            this.permissionRequests.delete(verdict.messageId);
            await this.mcp.notification({
              method: "notifications/hooman/channel/permission",
              params: {
                request_id: verdict.requestId,
                behavior: verdict.behavior,
              },
            } as never);
            return;
          }

          const event = await this.createEvent(message);
          if (!this.isAllowed(event.message)) {
            return;
          }
          await this.mcp.notification({
            method: `notifications/${this.channel}`,
            params: {
              content: JSON.stringify(event),
              attachments: event.message.attachments,
              meta: {
                source: "whatsapp",
                user: event.message.sender.id,
                session: event.message.chat.id,
                thread: event.message.id,
              },
            },
          } as never);
        } catch {
          // Transport closed, unsupported client, or other send failure.
        }
      })();
    };

    this.session.client!.on("message", onMessage);
    this.unsubscribe = () => this.session.client?.off("message", onMessage);

    const onclose = this.mcp.onclose;
    this.mcp.onclose = () => {
      this.stop();
      onclose?.();
    };
  }

  private stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async createEvent(
    message: WwebMessage,
  ): Promise<MessageChannelEvent> {
    let quoted: WwebMessage | undefined;
    if (message.hasQuotedMsg) {
      try {
        quoted = await message.getQuotedMessage();
      } catch {
        // Quoted message may have been deleted.
      }
    }

    const attachments: string[] = [];
    if (message.hasMedia) {
      const path = await saveMessageMedia(message);
      if (path) attachments.push(path);
    }

    if (quoted?.hasMedia) {
      const path = await saveMessageMedia(quoted);
      if (path) attachments.push(path);
    }

    const msg = await this.session.transform(message);
    const parent = quoted ? await this.session.transform(quoted) : undefined;

    return {
      source: "whatsapp",
      self: this.self!,
      message: { ...msg, attachments, parent },
      text: msg.body,
    };
  }

  private async parsePermissionVerdict(message: WwebMessage): Promise<{
    requestId: string;
    behavior: ChannelPermissionBehavior;
    messageId: string;
  } | null> {
    if (!message.hasQuotedMsg) {
      return null;
    }

    let quoted: WwebMessage | undefined;
    try {
      quoted = await message.getQuotedMessage();
    } catch {
      return null;
    }

    const messageId = quoted?.id?._serialized;
    if (!messageId) {
      return null;
    }

    const requestId = this.permissionRequests.get(messageId);
    if (!requestId) {
      return null;
    }

    const behavior = parsePermissionBehavior(message.body ?? "");
    if (!behavior) {
      return null;
    }

    return {
      requestId,
      behavior,
      messageId,
    };
  }

  private isAllowed(message: Message | MessageWithParent): boolean {
    const allowlist = this.allowlist;
    if (!allowlist || !allowlist.enabled) {
      return true;
    }
    const isChatAllowed = allowlist.chats.has(message.chat.id);
    const userId = message.sender.id.trim();
    const isUserAllowed = Boolean(userId && allowlist.users.has(userId));
    return isChatAllowed || isUserAllowed;
  }
}

function parsePermissionBehavior(
  text: string,
): ChannelPermissionBehavior | null {
  const command = text.trim().toLowerCase();
  if (!command) {
    return null;
  }

  if (command === "yes" || command === "y" || command === "allow") {
    return "allow_once";
  }

  if (command === "always" || command === "a" || command === "allow always") {
    return "allow_always";
  }

  if (command === "no" || command === "n" || command === "deny") {
    return "deny";
  }

  return null;
}
