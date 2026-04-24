import type { WhatsAppConfig } from "../lib/whatsapp/config.js";

export type MenuAction = () => void | Promise<void>;

export type MenuItem = {
  key?: string;
  label: string;
  boldSubstring?: string;
  value: MenuAction;
};

export type Notice = {
  kind: "success" | "error" | "info";
  text: string;
};

export type ConfigureScreen =
  | { kind: "home" }
  | { kind: "edit-users" }
  | { kind: "edit-chats" };

export type ConfigureAppProps = {
  initial: WhatsAppConfig;
  onSave: (config: WhatsAppConfig) => Promise<void>;
  onExit: () => void;
};
