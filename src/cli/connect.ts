import type { Command as CommanderCommand } from "commander";
import { CliIO } from "../lib/cli-io.js";
import { parseFiniteNumber } from "../lib/number.js";
import { register } from "../lib/signal-handler.js";
import type { CliCommand } from "../types.js";

const DEFAULT_WAIT_FOR_MS = 300_000;

export class ConnectCommand implements CliCommand {
  constructor(private readonly io = new CliIO()) {}

  register(program: CommanderCommand): void {
    program
      .command("connect")
      .description(
        "Start WhatsApp, show QR if needed, wait until connected, then exit",
      )
      .requiredOption("--profile <name>", "Profile name, for example sales")
      .option(
        "--wait-for <ms>",
        "Maximum time to wait for WhatsApp startup state before giving up",
        String(DEFAULT_WAIT_FOR_MS),
      )
      .option(
        "--json",
        'Print QR updates as JSON lines ({"qr":"..."}) instead of terminal QR art',
      )
      .action(this.action.bind(this));
  }

  private async action(options: {
    profile: string;
    waitFor: string;
    json?: boolean;
  }): Promise<void> {
    const waitForMs = parseFiniteNumber(options.waitFor, "--wait-for");

    if (waitForMs === undefined || waitForMs < 0) {
      throw new Error(
        "--wait-for must be a non-negative number of milliseconds",
      );
    }

    const { WhatsAppSession } = await import("../lib/whatsapp/session.js");
    const session = new WhatsAppSession({
      profile: options.profile,
      io: this.io,
      onQr: (qr: string) => {
        if (options.json) {
          this.io.line(JSON.stringify({ qr }));
          return;
        }
        this.io.qr(qr);
      },
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
      this.io.line("Shutting down WhatsApp session...");
      await closeSession();
    });

    try {
      this.io.line(`Starting WhatsApp for profile "${options.profile}"...`);
      await session.start();
      await session.waitForReady(waitForMs);
      this.io.line("Connected successfully.");
    } finally {
      unregister();
      await closeSession();
    }
  }
}
