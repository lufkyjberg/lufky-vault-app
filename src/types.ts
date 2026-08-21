export type VaultEntryMeta = {
  id: string;
  title: string;
  username: string;
  url: string;
  tags: string[];
  hasPassword: boolean;
};

export type EntryDetail = VaultEntryMeta & {
  email: string;
  phone: string;
  description: string;
  notes: string;
};

export type OpenVaultResponse = {
  entries: VaultEntryMeta[];
  databaseVersion: string;
  writeSupported: boolean;
};

export type CreateVaultResponse = OpenVaultResponse & {
  path: string;
};

export type SaveEntryResponse = {
  entries: VaultEntryMeta[];
  selectedId: string;
  backupPath: string;
};

export type EntryDraft = {
  id: string | null;
  title: string;
  username: string;
  password: string;
  replacePassword: boolean;
  url: string;
  email: string;
  phone: string;
  description: string;
  notes: string;
  tags: string[];
};

export type ShortcutAction =
  | "copyPassword"
  | "copyUsername"
  | "copyUrl"
  | "focusSearch"
  | "newEntry"
  | "editEntry"
  | "lockVault"
  | "openSettings"
  | "revealPassword";

export type DisplayField =
  | "username"
  | "password"
  | "url"
  | "email"
  | "phone"
  | "tags"
  | "description"
  | "notes";

export type AppSettings = {
  autoLockMinutes: number;
  revealSeconds: number;
  lockOnBlur: boolean;
  lockOnSecureDesktop: boolean;
  contentProtection: boolean;
  experimentalWrites: boolean;
  visibleFields: Record<DisplayField, boolean>;
  shortcuts: Record<ShortcutAction, string>;
};
