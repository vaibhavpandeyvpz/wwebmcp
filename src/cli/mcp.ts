import process from "node:process";
import type { Command as CommanderCommand } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CliIO } from "../lib/cli-io.js";
import { WhatsAppMcpServer } from "../lib/mcp/server.js";
import { parseFiniteNumber } from "../lib/number.js";
import { register } from "../lib/signal-handler.js";
import {
  createEventAllowlist,
  loadWhatsAppConfig,
} from "../lib/whatsapp/config.js";
import type { CliCommand } from "../types.js";

const DEFAULT_WAIT_FOR_MS = 60_000;

export class McpCommand implements CliCommand {
  constructor(
    private readonly io = new CliIO(process.stderr, process.stderr),
  ) {}

  register(program: CommanderCommand): void {
    program
      .command("mcp")
      .description("Start the stdio MCP server for WhatsApp")
      .option(
        "--channels",
        "Enable hooman/channel notifications for WhatsApp messages",
      )
      .option(
        "--wait-for <ms>",
        "Maximum time to wait for WhatsApp startup state before giving up",
        String(DEFAULT_WAIT_FOR_MS),
      )
      .action(this.action.bind(this));
  }

  private async action(options: {
    channels?: boolean;
    waitFor: string;
  }): Promise<void> {
    const waitForMs = parseFiniteNumber(options.waitFor, "--wait-for");
    let keep = false;

    if (waitForMs === undefined || waitForMs < 0) {
      throw new Error(
        "--wait-for must be a non-negative number of milliseconds",
      );
    }

    const config = await loadWhatsAppConfig();
    const { WhatsAppSession } = await import("../lib/whatsapp/session.js");
    const session = new WhatsAppSession({
      io: this.io,
    });
    let destroyed = false;
    const closeSession = async () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      await session.destroy();
    };
    const unregister = register(async () => {
      this.io.line("Shutting down WhatsApp MCP server...");
      await closeSession();
    });

    try {
      this.io.line("Starting WhatsApp MCP server...");
      await session.start();
      const outcome = await session.waitForStartup(waitForMs);

      if (outcome.kind === "ready") {
        const allowlist = options.channels
          ? createEventAllowlist(config.allowlist)
          : undefined;
        const server = WhatsAppMcpServer.create(
          session,
          Boolean(options.channels),
          allowlist,
        );
        await server.start(new StdioServerTransport());
        if (options.channels) {
          await server.subscribe();
        }
        keep = true;
        return;
      }

      if (outcome.kind === "qr") {
        this.io.line(
          'WhatsApp is not connected. Run "wappmcp configure" first.',
        );
      } else if (outcome.kind === "auth_failure") {
        this.io.line(`Authentication failed: ${outcome.message}`);
      } else if (outcome.kind === "disconnected") {
        this.io.line(`Disconnected: ${outcome.reason}`);
      } else {
        this.io.line("Timed out waiting for WhatsApp to connect.");
      }

      process.exitCode = 1;
    } finally {
      unregister();
      if (!keep) {
        await closeSession();
      }
    }
  }
}
