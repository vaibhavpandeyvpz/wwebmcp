import type { Command as CommanderCommand } from "commander";
import type { CliCommand } from "../types.js";
import { configure } from "../configure/index.js";

export class ConfigureCommand implements CliCommand {
  register(program: CommanderCommand): void {
    program
      .command("configure")
      .description(
        "Interactively manage WhatsApp connection and event allowlist in .wappmcp/config.json.",
      )
      .action(this.action.bind(this));
  }

  private async action(): Promise<void> {
    await configure();
  }
}
