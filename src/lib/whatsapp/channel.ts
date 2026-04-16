import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { WhatsAppSession } from "./session.js";
import type {
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
  ) {}

  async start(): Promise<void> {
    this.self = await this.session.getMe();

    const onMessage = (message: WwebMessage) => {
      void (async () => {
        try {
          const event = await this.createEvent(message);
          await this.mcp.notification({
            method: `notifications/${this.channel}`,
            params: {
              content: JSON.stringify(event),
              meta: {
                source: "whatsapp",
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
}
