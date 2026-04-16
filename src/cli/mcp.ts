import process from "node:process";
import type { Command as CommanderCommand } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CliIO } from "../lib/cli-io.js";
import { WhatsAppMcpServer } from "../lib/mcp/server.js";
import { parseFiniteNumber } from "../lib/number.js";
import { register } from "../lib/signal-handler.js";
import type { CliCommand } from "../types.js";

const DEFAULT_WAIT_FOR_MS = 60_000;

export class McpCommand implements CliCommand {
  constructor(
    private readonly io = new CliIO(process.stderr, process.stderr),
  ) {}

  register(program: CommanderCommand): void {
    program
      .command("mcp")
      .description("Start the stdio MCP server for a WhatsApp profile")
      .requiredOption("--profile <name>", "Profile name, for example sales")
      .option("--channel <name>", "Channel name, for receiving notifications")
      .option(
        "--wait-for <ms>",
        "Maximum time to wait for WhatsApp startup state before giving up",
        String(DEFAULT_WAIT_FOR_MS),
      )
      .action(this.action.bind(this));
  }

  private async action(options: {
    profile: string;
    channel?: string;
    waitFor: string;
  }): Promise<void> {
    const waitForMs = parseFiniteNumber(options.waitFor, "--wait-for");
    let keep = false;

    if (waitForMs === undefined || waitForMs < 0) {
      throw new Error(
        "--wait-for must be a non-negative number of milliseconds",
      );
    }

    const { WhatsAppSession } = await import("../lib/whatsapp/session.js");
    const session = new WhatsAppSession({
      profile: options.profile,
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
      this.io.line(
        `Shutting down MCP server for profile "${options.profile}"...`,
      );
      await closeSession();
    });

    try {
      this.io.line(`Starting MCP server for profile "${options.profile}"...`);
      await session.start();
      const outcome = await session.waitForStartup(waitForMs);

      if (outcome.kind === "ready") {
        const server = WhatsAppMcpServer.create(session, options.channel);
        await server.start(new StdioServerTransport());
        if (options.channel) {
          await server.subscribe();
        }
        keep = true;
        return;
      }

      if (outcome.kind === "qr") {
        this.io.line(
          `Profile "${options.profile}" is not connected. Run "wappmcp connect --profile ${options.profile}" first.`,
        );
      } else if (outcome.kind === "auth_failure") {
        this.io.line(`Authentication failed: ${outcome.message}`);
      } else if (outcome.kind === "disconnected") {
        this.io.line(`Disconnected: ${outcome.reason}`);
      } else {
        this.io.line(
          `Timed out waiting for profile "${options.profile}" to connect.`,
        );
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
