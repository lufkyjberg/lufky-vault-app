import type { AppSettings, DisplayField, ShortcutAction } from "./types";

export const shortcutLabels: Record<ShortcutAction, string> = {
  copyPassword: "Копировать пароль",
  copyUsername: "Копировать логин",
  copyUrl: "Копировать URL",
  focusSearch: "Фокус на поиск",
  newEntry: "Новая запись",
  editEntry: "Редактировать запись",
  lockVault: "Заблокировать Vault",
  openSettings: "Открыть настройки",
  revealPassword: "Показать / скрыть пароль"
};

export const displayFieldLabels: Record<DisplayField, string> = {
  username: "Логин",
  password: "Пароль",
  url: "URL / сайт",
  email: "Email",
  phone: "Телефон",
  tags: "Теги",
  description: "Описание",
  notes: "Заметки"
};

export const defaultSettings: AppSettings = {
  autoLockMinutes: 5,
  revealSeconds: 10,
  lockOnBlur: false,
  lockOnSecureDesktop: true,
  contentProtection: true,
  experimentalWrites: false,
  visibleFields: {
    username: true,
    password: true,
    url: true,
    email: true,
    phone: true,
    tags: true,
    description: true,
    notes: true
  },
  shortcuts: {
    copyPassword: "Ctrl+C",
    copyUsername: "Ctrl+B",
    copyUrl: "Ctrl+U",
    focusSearch: "Ctrl+F",
    newEntry: "Ctrl+N",
    editEntry: "Ctrl+E",
    lockVault: "Ctrl+L",
    openSettings: "Ctrl+,",
    revealPassword: "Ctrl+P"
  }
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("vault.settings.v1");
    if (!raw) return defaultSettings;

    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      ...defaultSettings,
      ...parsed,
      visibleFields: {
        ...defaultSettings.visibleFields,
        ...(parsed.visibleFields ?? {})
      },
      shortcuts: {
        ...defaultSettings.shortcuts,
        ...(parsed.shortcuts ?? {})
      }
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem("vault.settings.v1", JSON.stringify(settings));
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;

  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

export function eventToShortcut(event: KeyboardEvent) {
  const parts: string[] = [];

  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");

  let key = event.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();

  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) parts.push(key);
  return parts.join("+");
}

export function shortcutMatches(event: KeyboardEvent, shortcut: string) {
  return shortcut !== "" && eventToShortcut(event) === shortcut;
}
