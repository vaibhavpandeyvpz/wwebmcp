import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_FOLDER = ".wappmcp";

export function attachmentsRoot(): string {
  return join(homedir(), APP_FOLDER, "attachments");
}

export function webCacheRoot(): string {
  return join(homedir(), APP_FOLDER, ".wwebjs_cache");
}

export function profilesRoot(): string {
  return join(homedir(), APP_FOLDER, "profiles");
}

export function assertProfileName(profile: string): string {
  const normalized = profile.trim();
  if (!normalized) {
    throw new Error("Profile name is required.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(
      "Profile names may only contain letters, numbers, hyphens, and underscores.",
    );
  }

  return normalized;
}

export function profilePath(profile: string): string {
  return join(profilesRoot(), assertProfileName(profile));
}

export async function ensureProfilesRoot(): Promise<string> {
  const root = profilesRoot();
  await mkdir(root, { recursive: true });
  return root;
}

export async function deleteProfile(profile: string): Promise<void> {
  await rm(profilePath(profile), { recursive: true, force: true });
}
