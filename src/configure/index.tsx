import React from "react";
import { render } from "ink";
import {
  loadWhatsAppConfig,
  saveWhatsAppConfig,
} from "../lib/whatsapp/config.js";
import { ConfigureApp } from "./app.js";

export async function configure(): Promise<void> {
  const initial = await loadWhatsAppConfig();
  let done = false;
  const { waitUntilExit, unmount } = render(
    <ConfigureApp
      initial={initial}
      onSave={async (config) => {
        await saveWhatsAppConfig(config);
      }}
      onExit={() => {
        done = true;
      }}
    />,
    { exitOnCtrlC: false },
  );

  try {
    await waitUntilExit();
  } finally {
    if (!done) {
      unmount();
    }
  }
}
