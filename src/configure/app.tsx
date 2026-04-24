import React, { useCallback, useMemo, useState } from "react";
import qrcode from "qrcode-terminal";
import { Box, Text, useApp, useInput } from "ink";
import {
  configPath,
  deleteProfile,
  profilePath,
  rootPath,
} from "../lib/paths.js";
import type { WhatsAppConfig } from "../lib/whatsapp/config.js";
import type { Chat, Contact } from "../lib/whatsapp/types.js";
import { BusyScreen } from "./components/BusyScreen.js";
import { HomeScreen } from "./components/HomeScreen.js";
import { MenuScreen } from "./components/MenuScreen.js";
import type {
  ConfigureAppProps,
  ConfigureScreen,
  MenuItem,
  Notice,
} from "./types.js";

const CONNECT_WAIT_FOR_MS = 300_000;
const DISCONNECT_WAIT_FOR_MS = 60_000;

type UserCandidate = {
  id: string;
  label: string;
};

type ChatCandidate = {
  id: string;
  label: string;
};

export function ConfigureApp({
  initial,
  onSave,
  onExit,
}: ConfigureAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<ConfigureScreen>({ kind: "home" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [qrText, setQrText] = useState<string | null>(null);
  const [draft, setDraft] = useState<WhatsAppConfig>(initial);
  const [users, setUsers] = useState<UserCandidate[] | null>(null);
  const [chats, setChats] = useState<ChatCandidate[] | null>(null);

  const runTask = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusyMessage(label);
      setQrText(null);
      try {
        await task();
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyMessage(null);
        setQrText(null);
      }
    },
    [],
  );

  const setSuccess = useCallback((text: string) => {
    setNotice({ kind: "success", text });
  }, []);

  useInput(
    (input, key) => {
      if (key.ctrl && input.toLowerCase() === "c") {
        onExit();
        exit();
        return;
      }
      if (!key.escape || busyMessage) {
        return;
      }
      if (screen.kind !== "home") {
        setScreen({ kind: "home" });
      }
    },
    { isActive: true },
  );

  const connectWhatsApp = useCallback(() => {
    void runTask("Connecting WhatsApp...", async () => {
      const { WhatsAppSession } = await import("../lib/whatsapp/session.js");
      const session = new WhatsAppSession({
        onQr: (qr) => {
          void renderQr(qr).then(setQrText);
        },
      });
      try {
        await session.start();
        const startup = await session.waitForStartup(CONNECT_WAIT_FOR_MS);
        if (startup.kind === "ready") {
          setSuccess("WhatsApp connected.");
          return;
        }
        if (startup.kind === "qr") {
          await session.waitForReady(CONNECT_WAIT_FOR_MS);
          setSuccess("WhatsApp connected.");
          return;
        }
        if (startup.kind === "auth_failure") {
          throw new Error(`Authentication failed: ${startup.message}`);
        }
        if (startup.kind === "disconnected") {
          throw new Error(`Disconnected: ${startup.reason}`);
        }
        throw new Error("Timed out waiting for WhatsApp to connect.");
      } finally {
        await session.destroy();
      }
    });
  }, [runTask, setSuccess]);

  const disconnectWhatsApp = useCallback(() => {
    void runTask("Disconnecting WhatsApp...", async () => {
      const { WhatsAppSession } = await import("../lib/whatsapp/session.js");
      const session = new WhatsAppSession({});
      try {
        await session.start();
        const startup = await session.waitForStartup(DISCONNECT_WAIT_FOR_MS);
        if (startup.kind === "ready") {
          await session.logOut();
        }
      } finally {
        await session.destroy();
        await deleteProfile();
      }
      setSuccess("Disconnected WhatsApp and removed local profile data.");
    });
  }, [runTask, setSuccess]);

  const loadAllowlistCandidates = useCallback(() => {
    void runTask("Loading WhatsApp users and chats...", async () => {
      const { WhatsAppSession } = await import("../lib/whatsapp/session.js");
      const session = new WhatsAppSession({
        onQr: (qr) => {
          void renderQr(qr).then(setQrText);
        },
      });
      try {
        await session.start();
        const startup = await session.waitForStartup(CONNECT_WAIT_FOR_MS);
        if (startup.kind !== "ready") {
          throw new Error(
            'WhatsApp is not connected yet. Choose "Connect WhatsApp" first.',
          );
        }
        const [contacts, loadedChats] = await Promise.all([
          session.listContacts(),
          session.listChats(),
        ]);
        setUsers(contacts.map(mapUserCandidate));
        setChats(loadedChats.map(mapChatCandidate));
      } finally {
        await session.destroy();
      }
    });
  }, [runTask]);

  const openUsersEditor = useCallback(() => {
    loadAllowlistCandidates();
    setScreen({ kind: "edit-users" });
  }, [loadAllowlistCandidates]);

  const openChatsEditor = useCallback(() => {
    loadAllowlistCandidates();
    setScreen({ kind: "edit-chats" });
  }, [loadAllowlistCandidates]);

  const saveAndExit = useCallback(() => {
    void runTask("Saving configuration...", async () => {
      await onSave(draft);
      onExit();
      exit();
    });
  }, [draft, exit, onExit, onSave, runTask]);

  const summary = useMemo(
    () =>
      `users:${draft.allowlist.users.length} • chats:${draft.allowlist.chats.length}`,
    [draft],
  );

  const renderHome = () => {
    const items: MenuItem[] = [
      {
        label: "Connect WhatsApp",
        value: connectWhatsApp,
      },
      {
        label: "Disconnect WhatsApp",
        value: disconnectWhatsApp,
      },
      {
        label: `Allowed users • ${draft.allowlist.users.length} selected`,
        value: openUsersEditor,
      },
      {
        label: `Allowed chats • ${draft.allowlist.chats.length} selected`,
        value: openChatsEditor,
      },
      {
        label: "Save and exit",
        value: saveAndExit,
      },
      {
        label: "Exit without saving",
        value: () => {
          onExit();
          exit();
        },
      },
    ];
    return (
      <HomeScreen
        rootPath={rootPath()}
        configPath={configPath()}
        profilePath={profilePath()}
        items={items}
      />
    );
  };

  const renderUsersEditor = () => {
    const entries = users ?? [];
    const selected = new Set(draft.allowlist.users);
    const merged = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of selected) {
      if (!merged.has(id)) {
        merged.set(id, { id, label: id });
      }
    }
    const displayEntries = Array.from(merged.values()).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const items: MenuItem[] = [
      ...displayEntries.map((user) => {
        const isSelected = selected.has(user.id);
        return {
          key: `user:${user.id}`,
          label: `${isSelected ? "[x]" : "[ ]"} ${user.label}`,
          value: () => {
            setDraft((current) => ({
              ...current,
              allowlist: {
                ...current.allowlist,
                users: toggleId(current.allowlist.users, user.id),
              },
            }));
          },
        };
      }),
      {
        key: "users:back",
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];
    return (
      <MenuScreen
        title="Allowed Users"
        description="Toggle users for inbound event allowlist."
        items={items}
        searchable
        pageSize={5}
        footerHint="type: search | enter: toggle/select | esc: back | ctrl+c: exit"
      />
    );
  };

  const renderChatsEditor = () => {
    const entries = chats ?? [];
    const selected = new Set(draft.allowlist.chats);
    const merged = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of selected) {
      if (!merged.has(id)) {
        merged.set(id, { id, label: id });
      }
    }
    const displayEntries = Array.from(merged.values()).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const items: MenuItem[] = [
      ...displayEntries.map((chat) => {
        const isSelected = selected.has(chat.id);
        return {
          key: `chat:${chat.id}`,
          label: `${isSelected ? "[x]" : "[ ]"} ${chat.label}`,
          value: () => {
            setDraft((current) => ({
              ...current,
              allowlist: {
                ...current.allowlist,
                chats: toggleId(current.allowlist.chats, chat.id),
              },
            }));
          },
        };
      }),
      {
        key: "chats:back",
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];
    return (
      <MenuScreen
        title="Allowed Chats"
        description="Toggle chats for inbound event allowlist."
        items={items}
        searchable
        pageSize={5}
        footerHint="type: search | enter: toggle/select | esc: back | ctrl+c: exit"
      />
    );
  };

  const body = (() => {
    if (busyMessage) {
      return <BusyScreen message={busyMessage} qrText={qrText} />;
    }
    if (screen.kind === "edit-users") {
      return renderUsersEditor();
    }
    if (screen.kind === "edit-chats") {
      return renderChatsEditor();
    }
    return renderHome();
  })();

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {notice ? (
        <Box marginTop={1}>
          <Text color={noticeColor(notice.kind)}>{notice.text}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color="gray">{summary}</Text>
      </Box>
      {body}
    </Box>
  );
}

function mapUserCandidate(contact: Contact): UserCandidate {
  const label =
    contact.name?.trim() ||
    contact.pushname?.trim() ||
    contact.number?.trim() ||
    contact.id;
  return { id: contact.id, label: `${label} (${contact.id})` };
}

function mapChatCandidate(chat: Chat): ChatCandidate {
  const label = chat.name?.trim() || chat.id;
  return { id: chat.id, label: `${label} (${chat.id})` };
}

function noticeColor(kind: Notice["kind"]): "green" | "yellow" | "red" {
  if (kind === "success") {
    return "green";
  }
  if (kind === "info") {
    return "yellow";
  }
  return "red";
}

function toggleId(list: ReadonlyArray<string>, id: string): string[] {
  const set = new Set(list);
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function renderQr(value: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(value, { small: true }, (rendered) => {
      resolve(rendered.trim());
    });
  });
}
