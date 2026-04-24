import wwebjs from "whatsapp-web.js";
import type {
  Client as WwebClient,
  MessageMedia as WwebMessageMedia,
} from "whatsapp-web.js";
import type {
  Chat,
  ChatParticipant,
  ChatWithParticipants,
  Connection,
  ConnectionState,
  Contact,
  ContactSearchResult,
  Device,
  Entity,
  LookupResult,
  Message,
  MessageSearchResult,
  WwebChat,
  WwebContact,
  WwebGroupParticipant,
  WwebMessage,
} from "./types.js";
import { CliIO } from "../cli-io.js";
import { createDeferred } from "../deferred-promise.js";
import { profilePath, webCacheRoot } from "../paths.js";

const { Client, LocalAuth, MessageMedia } = wwebjs;

const executablePath =
  process.env.WAPPMCP_BROWSER_PATH ||
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "";

export type StartResult =
  | { kind: "ready"; info: Connection }
  | { kind: "qr"; qr: string }
  | { kind: "auth_failure"; message: string }
  | { kind: "disconnected"; reason: string }
  | { kind: "timeout" };

export class WhatsAppSession {
  private readonly io: CliIO;
  private wwebjs: WwebClient | null = null;

  private qr?: string;
  private readonly onQr: (qr: string) => void;
  private state: ConnectionState = "idle";

  private initializePromise?: Promise<void>;
  private readonly readyDeferred = createDeferred<Connection>();
  private readonly qrDeferred = createDeferred<string>();
  private readonly authFailureDeferred = createDeferred<string>();
  private readonly disconnectedDeferred = createDeferred<string>();

  constructor(options: { io?: CliIO; onQr?: (qr: string) => void }) {
    this.io = options.io ?? new CliIO();
    this.onQr = options.onQr ?? (() => {});
  }

  get client(): InstanceType<typeof Client> | null {
    return this.wwebjs;
  }

  async start(): Promise<void> {
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.initializePromise = this.connect().finally(() => {
      this.initializePromise = undefined;
    });

    await this.initializePromise;
  }

  async waitForStartup(timeoutMs: number): Promise<StartResult> {
    return Promise.race([
      this.readyDeferred.promise.then(
        (info) => ({ kind: "ready", info }) as const,
      ),
      this.qrDeferred.promise.then((qr) => ({ kind: "qr", qr }) as const),
      this.authFailureDeferred.promise.then(
        (message) => ({ kind: "auth_failure", message }) as const,
      ),
      this.disconnectedDeferred.promise.then(
        (reason) => ({ kind: "disconnected", reason }) as const,
      ),
      new Promise((resolve) => {
        setTimeout(resolve, timeoutMs);
      }).then(() => ({ kind: "timeout" }) as const),
    ]);
  }

  async waitForReady(timeoutMs: number): Promise<void> {
    const result = await Promise.race([
      this.readyDeferred.promise.then(() => ({ kind: "ready" }) as const),
      this.authFailureDeferred.promise.then(
        (message) => ({ kind: "auth_failure", message }) as const,
      ),
      this.disconnectedDeferred.promise.then(
        (reason) => ({ kind: "disconnected", reason }) as const,
      ),
      new Promise((resolve) => {
        setTimeout(resolve, timeoutMs);
      }).then(() => ({ kind: "timeout" }) as const),
    ]);

    if (result.kind === "ready") {
      return;
    }

    if (result.kind === "auth_failure") {
      throw new Error(`Authentication failed: ${result.message}`);
    }

    if (result.kind === "disconnected") {
      throw new Error(`Disconnected: ${result.reason}`);
    }

    throw new Error("Timeout waiting for startup");
  }

  async destroy(): Promise<void> {
    const client = this.wwebjs;
    this.wwebjs = null;
    this.state = "disconnected";

    if (!client) {
      return;
    }

    try {
      await Promise.race([
        client.destroy(),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 5000);
        }),
      ]);
    } catch {
      // Continue with best-effort browser cleanup.
    }

    client.removeAllListeners();

    const browser = (
      client as unknown as {
        pupBrowser?: {
          close?: () => Promise<void>;
          process?: () => { kill: (signal?: string) => void } | null;
        };
      }
    ).pupBrowser;

    if (!browser) {
      return;
    }

    try {
      await browser.close?.();
    } catch {
      // Ignore close failures and try terminating process directly.
    }

    try {
      browser.process?.()?.kill("SIGKILL");
    } catch {
      // Ignore final cleanup failures.
    }
  }

  async logOut(): Promise<void> {
    await this.client!.logout();
  }

  async listChats(): Promise<Chat[]> {
    const chats = await this.client!.getChats();

    const items: Chat[] = await Promise.all(
      chats.map(async (chat: WwebChat) => {
        let name: string | undefined =
          typeof chat.name === "string" && chat.name.trim()
            ? chat.name.trim()
            : undefined;

        if (!name && !chat.isGroup) {
          try {
            const contact = await chat.getContact();
            name = (contact.pushname || contact.name || "").trim() || undefined;
          } catch {
            // Ignore contact lookup issues for unnamed chats.
          }
        }

        return {
          id: chat.id._serialized,
          name,
          flags: {
            group: Boolean(chat.isGroup),
          },
          unreads: Number(chat.unreadCount ?? 0),
          timestamp: new Date(Number(chat.timestamp ?? 0) * 1000),
        };
      }),
    );

    items.sort((left, right) => {
      if (left.flags.group !== right.flags.group) {
        return left.flags.group ? -1 : 1;
      }

      return String(left.name ?? left.id).localeCompare(
        String(right.name ?? right.id),
      );
    });

    return items;
  }

  async getChatInfo(chatId: string): Promise<ChatWithParticipants> {
    const chat = await this.client!.getChatById(chatId);
    const item = {
      id: chat.id._serialized,
      name: chat.name || undefined,
      flags: {
        group: Boolean(chat.isGroup),
      },
      unreads: Number(chat.unreadCount ?? 0),
      timestamp: new Date(Number(chat.timestamp ?? 0) * 1000),
    };

    if (
      chat.isGroup &&
      "participants" in chat &&
      Array.isArray(chat.participants)
    ) {
      return {
        ...item,
        participants: chat.participants.map(
          (participant: WwebGroupParticipant) => ({
            id: participant.id._serialized,
            flags: {
              admin: Boolean(participant.isAdmin),
              superadmin: Boolean(participant.isSuperAdmin),
            },
          }),
        ),
      };
    }

    return item;
  }

  async listContacts(): Promise<Contact[]> {
    const contacts = await this.client!.getContacts();
    const items: Contact[] = contacts.map((contact: WwebContact) => ({
      id: contact.id._serialized,
      name: contact.name?.trim() || undefined,
      pushname: contact.pushname?.trim() || undefined,
      number:
        contact.id && typeof contact.id === "object" && "user" in contact.id
          ? (contact.id.user ?? "")
          : undefined,
      flags: {
        enterprise: false,
      },
    }));

    items.sort((left, right) =>
      (
        left.name ??
        left.pushname ??
        left.number ??
        left.id ??
        ""
      ).localeCompare(
        right.name ?? right.pushname ?? right.number ?? right.id ?? "",
      ),
    );

    return items;
  }

  async searchContacts(q: string, limit = 20): Promise<ContactSearchResult> {
    const contacts = await this.client!.getContacts();
    const matches = contacts
      .map((contact) => {
        const item = {
          id: contact.id._serialized,
          name: contact.name?.trim() || undefined,
          pushname: contact.pushname?.trim() || undefined,
          number:
            contact.id && typeof contact.id === "object" && "user" in contact.id
              ? contact.id.user
              : undefined,
          flags: {
            enterprise: false,
          },
        };

        const fields = [item.id, item.name, item.pushname, item.number]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase());

        const exact = fields.some((value) => value === q);
        const startsWith = fields.some((value) => value.startsWith(q));
        const includes = fields.some((value) => value.includes(q));
        const score = exact ? 3 : startsWith ? 2 : includes ? 1 : 0;

        return {
          ...item,
          score,
        };
      })
      .filter((contact) => contact.score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return (
          left.name ??
          left.pushname ??
          left.number ??
          left.id ??
          ""
        ).localeCompare(
          right.name ?? right.pushname ?? right.number ?? right.id ?? "",
        );
      });

    const max = Math.min(Math.max(1, limit), 50);
    return {
      contacts: matches
        .slice(0, max)
        .map(({ score: _score, ...contact }) => contact),
      meta: {
        q,
        total: matches.length,
        more: matches.length > max,
      },
    };
  }

  async getContactInfo(contactId: string): Promise<Contact> {
    const contact = await this.client!.getContactById(contactId);

    return {
      id: contact.id._serialized,
      name: contact.name?.trim() || undefined,
      pushname: contact.pushname?.trim() || undefined,
      number:
        contact.id && typeof contact.id === "object" && "user" in contact.id
          ? String((contact.id as { user?: string }).user ?? "") || undefined
          : undefined,
      flags: {
        enterprise: false,
      },
    };
  }

  async getChatParticipants(chatId: string): Promise<ChatParticipant[]> {
    const chat = await this.client!.getChatById(chatId);

    if (
      !chat.isGroup ||
      !("participants" in chat) ||
      !Array.isArray(chat.participants)
    ) {
      return [];
    }

    return chat.participants.map((participant: WwebGroupParticipant) => ({
      id: participant.id._serialized,
      flags: {
        admin: Boolean(participant.isAdmin),
        superadmin: Boolean(participant.isSuperAdmin),
      },
    }));
  }

  async sendMessage(chatId: string, text: string): Promise<string> {
    return this.client!.sendMessage(chatId, text).then(
      (message) => message.id._serialized,
    );
  }

  async sendMediaFromBase64(
    chatId: string,
    mimetype: string,
    data: string,
    filename?: string,
    caption?: string,
  ): Promise<string> {
    const media = new MessageMedia(
      mimetype || "application/octet-stream",
      data,
      filename,
    );
    return this.sendMedia(chatId, media, caption);
  }

  async sendMediaFromPath(
    chatId: string,
    path: string,
    caption?: string,
  ): Promise<string> {
    return this.sendMedia(chatId, MessageMedia.fromFilePath(path), caption);
  }

  private async sendMedia(
    chatId: string,
    media: WwebMessageMedia,
    caption?: string,
  ): Promise<string> {
    return this.client!.sendMessage(chatId, media, { caption }).then(
      (message) => message.id._serialized,
    );
  }

  async replyToMessage(
    messageId: string,
    text: string,
    chatId?: string,
  ): Promise<string> {
    const message = await this.client!.getMessageById(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    return message
      .reply(text, chatId)
      .then((message) => message.id._serialized);
  }

  async getChatMessages(chatId: string, limit = 50): Promise<Message[]> {
    const chat = await this.client!.getChatById(chatId);
    const messages = await chat.fetchMessages({
      limit: Math.min(Math.max(1, limit), 100),
    });

    return Promise.all(messages.map((message) => this.transform(message)));
  }

  async searchMessages(
    q: string,
    chatId?: string,
    page?: number,
    limit?: number,
  ): Promise<MessageSearchResult> {
    const messages = await this.client!.searchMessages(q, {
      chatId: chatId?.trim() || undefined,
      page,
      limit,
    });

    return {
      messages: await Promise.all(
        messages.map((message) => this.transform(message)),
      ),
      meta: {
        q,
        chat: chatId?.trim() ? { id: chatId.trim() } : undefined,
        page: page ?? undefined,
        limit: limit ?? undefined,
      },
    };
  }

  async getMessage(messageId: string): Promise<Message> {
    const message = await this.client!.getMessageById(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    return this.transform(message);
  }

  async reactToMessage(messageId: string, emoji: string = "👍"): Promise<void> {
    const message = await this.client!.getMessageById(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    await message.react(emoji);
  }

  async sendTyping(chatId: string): Promise<void> {
    const chat = await this.client!.getChatById(chatId);

    await chat.sendStateTyping();
  }

  async getLidForContact(contactId: string): Promise<string> {
    const [result] = await this.client!.getContactLidAndPhone([contactId]);

    return result?.lid!;
  }

  async lookupNumber(input: string): Promise<LookupResult> {
    const normalized = input.replace(/[^\d]/g, "");
    const q = normalized || input.trim();

    const [id, number] = await Promise.all([
      this.client!.getNumberId(q),
      this.client!.getFormattedNumber(q).catch(() => null),
    ]);

    return {
      q,
      id: id?._serialized,
      registered: id !== null,
      number: number ?? undefined,
    };
  }

  async editMessage(messageId: string, text: string): Promise<void> {
    const message = await this.client!.getMessageById(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    await message.edit(text);
  }

  async deleteMessage(
    messageId: string,
    everyone: boolean = false,
  ): Promise<void> {
    const message = await this.client!.getMessageById(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    await message.delete(everyone, false);
  }

  async forwardMessage(chatId: string, messageId: string): Promise<void> {
    const message = await this.client!.getMessageById(messageId);
    if (!message) {
      throw new Error(`Message with ID ${messageId} not found`);
    }

    await message.forward(chatId);
  }

  private async connect(): Promise<void> {
    if (this.wwebjs) {
      return;
    }

    const dataPath = profilePath();
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath }),
      webVersionCache: {
        type: "local",
        path: webCacheRoot(),
      },
      puppeteer: {
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      },
    });

    this.wwebjs = client;
    this.state = "starting";

    client.on("qr", (qr) => {
      this.state = "pairing";
      if (qr !== this.qr) {
        this.qr = qr;
        this.onQr(qr);
      }
      if (!this.qrDeferred.settled) {
        this.qrDeferred.resolve(qr);
      }
    });

    client.on("ready", async () => {
      this.state = "connected";
      const status = await this.getStatus();
      this.io.line(`Connected: ${status.status}`);
      if (!this.readyDeferred.settled) {
        this.readyDeferred.resolve(status);
      }
    });

    client.on("auth_failure", (message) => {
      this.state = "disconnected";
      this.io.error(`Failed to authenticate: ${message}`);
      if (!this.authFailureDeferred.settled) {
        this.authFailureDeferred.resolve(message);
      }
      if (!this.readyDeferred.settled) {
        this.readyDeferred.reject(
          new Error(`Authentication failed: ${message}`),
        );
      }
    });

    client.on("disconnected", (reason) => {
      this.state = "disconnected";
      this.io.error(`Disconnected: ${String(reason)}`);
      if (!this.disconnectedDeferred.settled) {
        this.disconnectedDeferred.resolve(String(reason));
      }
      if (!this.readyDeferred.settled) {
        this.readyDeferred.reject(
          new Error(
            `WhatsApp disconnected before becoming ready: ${String(reason)}`,
          ),
        );
      }
    });

    await client.initialize();
  }

  async getMe(): Promise<Entity> {
    const info = this.client!.info;
    const contact = await this.client!.getContactById(info.wid._serialized);
    const lid = await this.getLidForContact(contact.id._serialized);
    return {
      id: contact.id._serialized,
      name: contact.name,
      number: contact.id.user ? `+${contact.id.user}` : undefined,
      pushname: contact.pushname,
      wids: [contact.id._serialized, lid ?? ""].filter(Boolean),
    };
  }

  async getStatus(): Promise<Connection> {
    const info = this.client!.info;
    const battery = await info.getBatteryStatus();
    const device: Device = {
      version: await this.client!.getWWebVersion(),
      platform: info.platform,
      battery,
    };

    return {
      profile: {
        name: "default",
        path: profilePath(),
      },
      status: this.state,
      device,
    };
  }

  async transform(message: WwebMessage): Promise<Message> {
    const sender = await this.getContactInfo(message.author ?? message.from);
    const chat = await this.getChatInfo(
      message.fromMe ? message.to : message.from,
    );

    return {
      id: message.id._serialized,
      body: message.body ?? "",
      chat,
      sender,
      timestamp: new Date(Number(message.timestamp ?? 0) * 1000),
      type: message.type ?? null,
      flags: {
        outgoing: Boolean(message.fromMe),
        forwarded: Boolean(message.isForwarded),
        starred: Boolean(message.isStarred),
      },
      relationships: {
        media: Boolean(message.hasMedia),
        quoted: Boolean(message.hasQuotedMsg),
        reaction: Boolean(message.hasReaction),
      },
      attachments: [],
      links: Array.isArray(message.links)
        ? message.links
            .map((link) => link?.link)
            .filter((value): value is string => Boolean(value))
        : [],
      mentions: Array.isArray(message.mentionedIds) ? message.mentionedIds : [],
    };
  }
}
