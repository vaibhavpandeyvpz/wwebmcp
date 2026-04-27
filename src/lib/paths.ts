import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_FOLDER = ".wappmcp";

export function appRoot(): string {
  return join(homedir(), APP_FOLDER);
}

export function rootPath(): string {
  return appRoot();
}

export function configPath(): string {
  return join(appRoot(), "config.json");
}

export function attachmentsRoot(): string {
  return join(appRoot(), "attachments");
}

export function webCacheRoot(): string {
  return join(appRoot(), ".wwebjs_cache");
}

export function profilePath(): string {
  return join(appRoot(), "profile");
}

export async function deleteProfile(): Promise<void> {
  await rm(profilePath(), { recursive: true, force: true });
}
