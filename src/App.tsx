import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Clipboard,
  Database,
  Eye,
  EyeOff,
  FileKey2,
  Globe2,
  KeyRound,
  LockKeyhole,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Tag,
  UserRound,
  X
} from "lucide-react";
import CreateVaultModal from "./components/CreateVaultModal";
import EntryEditor from "./components/EntryEditor";
import SettingsModal from "./components/SettingsModal";
import {
  isEditableTarget,
  loadSettings,
  saveSettings,
  shortcutMatches
} from "./shortcuts";
import type {
  AppSettings,
  CreateVaultResponse,
  EntryDetail,
  EntryDraft,
  OpenVaultResponse,
  SaveEntryResponse,
  VaultEntryMeta
} from "./types";

const LAST_VAULT_KEY = "vault.lastPath.v1";

function shortName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function initials(entry: VaultEntryMeta) {
  const source = domain(entry.url) || entry.title || "?";
  return source.slice(0, 2).toUpperCase();
}

export default function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [vaultPath, setVaultPath] = useState(() => localStorage.getItem(LAST_VAULT_KEY) ?? "");
  const [masterPassword, setMasterPassword] = useState("");
  const [entries, setEntries] = useState<VaultEntryMeta[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [query, setQuery] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [databaseVersion, setDatabaseVersion] = useState("");
  const [writeSupported, setWriteSupported] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createVaultOpen, setCreateVaultOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDetail, setEditorDetail] = useState<EntryDetail | null>(null);
  const [backupNotice, setBackupNotice] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const activityTimer = useRef<number | null>(null);

  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;

    return entries.filter((entry) =>
      [entry.title, entry.username, entry.url, ...entry.tags]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [entries, query]);

  const applySecuritySettings = useCallback(async (next: AppSettings) => {
    await invoke("configure_security", {
      autoLockSeconds: next.autoLockMinutes * 60,
      lockOnBlur: next.lockOnBlur,
      lockOnSecureDesktop: next.lockOnSecureDesktop,
      contentProtection: next.contentProtection
    });
  }, []);

  const rememberVault = useCallback((path: string) => {
    localStorage.setItem(LAST_VAULT_KEY, path);
    setVaultPath(path);
  }, []);

  const clearFrontendSecrets = useCallback(() => {
    setShowPassword(false);
    setRevealedPassword("");
    setDetail(null);
    setMasterPassword("");
    setCopied("");
  }, []);

  const handleLocked = useCallback(() => {
    clearFrontendSecrets();
    setUnlocked(false);
    setEntries([]);
    setSelectedId("");
    setQuery("");
    setEditorOpen(false);
    setSettingsOpen(false);
    setCreateVaultOpen(false);
  }, [clearFrontendSecrets]);

  useEffect(() => {
    applySecuritySettings(settings).catch(() => {});
  }, [applySecuritySettings, settings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen("vault-locked", () => handleLocked()).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, [handleLocked]);

  useEffect(() => {
    setShowPassword(false);
    setRevealedPassword("");
    setDetail(null);

    if (!selected?.id) return;

    let cancelled = false;

    invoke<EntryDetail>("get_entry_detail", { id: selected.id })
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!showPassword || !revealedPassword) return;

    const timer = window.setTimeout(() => {
      setShowPassword(false);
      setRevealedPassword("");
    }, settings.revealSeconds * 1000);

    return () => window.clearTimeout(timer);
  }, [showPassword, revealedPassword, settings.revealSeconds]);

  useEffect(() => {
    if (!unlocked) return;

    const touch = () => {
      if (activityTimer.current !== null) return;

      activityTimer.current = window.setTimeout(() => {
        activityTimer.current = null;
        invoke("touch_activity").catch(() => {});
      }, 1500);
    };

    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    window.addEventListener("wheel", touch, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("wheel", touch);

      if (activityTimer.current !== null) window.clearTimeout(activityTimer.current);
      activityTimer.current = null;
    };
  }, [unlocked]);

  const revealPassword = useCallback(async () => {
    if (!selected?.id || !selected.hasPassword) return;

    if (showPassword) {
      setShowPassword(false);
      setRevealedPassword("");
      return;
    }

    try {
      const value = await invoke<string>("get_password", { id: selected.id });
      setRevealedPassword(value);
      setShowPassword(true);
    } catch (e) {
      setError(String(e));
    }
  }, [selected, showPassword]);

  const copyField = useCallback(async (
    field: "username" | "password" | "url" | "email" | "phone",
    label: string
  ) => {
    if (!selected?.id) return;

    try {
      await invoke("copy_entry_field", { id: selected.id, field });
      setCopied(label);
      window.setTimeout(() => setCopied((current) => current === label ? "" : current), 1000);
    } catch (e) {
      setError(String(e));
    }
  }, [selected?.id]);

  const startNewEntry = useCallback(() => {
    if (!writeSupported) {
      setError("Эта база не поддерживается текущим KDBX4 writer для записи.");
      return;
    }

    if (!settings.experimentalWrites) {
      setError("Сначала включи «Разрешить экспериментальную запись KDBX4» в настройках.");
      setSettingsOpen(true);
      return;
    }

    setEditorDetail(null);
    setEditorOpen(true);
  }, [settings.experimentalWrites, writeSupported]);

  const startEditEntry = useCallback(() => {
    if (!writeSupported || !detail) return;

    if (!settings.experimentalWrites) {
      setError("Сначала включи «Разрешить экспериментальную запись KDBX4» в настройках.");
      setSettingsOpen(true);
      return;
    }

    setEditorDetail(detail);
    setEditorOpen(true);
  }, [writeSupported, detail, settings.experimentalWrites]);

  const lockVault = useCallback(async () => {
    try {
      await invoke("lock_vault");
    } finally {
      handleLocked();
    }
  }, [handleLocked]);

  useEffect(() => {
    if (!unlocked || settingsOpen || editorOpen || createVaultOpen) return;

    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const shortcuts = settings.shortcuts;

      if (shortcutMatches(event, shortcuts.copyPassword)) {
        event.preventDefault();
        copyField("password", "password");
        return;
      }

      if (shortcutMatches(event, shortcuts.copyUsername)) {
        event.preventDefault();
        copyField("username", "login");
        return;
      }

      if (shortcutMatches(event, shortcuts.copyUrl)) {
        event.preventDefault();
        copyField("url", "url");
        return;
      }

      if (shortcutMatches(event, shortcuts.focusSearch)) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (shortcutMatches(event, shortcuts.newEntry)) {
        event.preventDefault();
        startNewEntry();
        return;
      }

      if (shortcutMatches(event, shortcuts.editEntry)) {
        event.preventDefault();
        startEditEntry();
        return;
      }

      if (shortcutMatches(event, shortcuts.lockVault)) {
        event.preventDefault();
        lockVault();
        return;
      }

      if (shortcutMatches(event, shortcuts.openSettings)) {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (shortcutMatches(event, shortcuts.revealPassword)) {
        event.preventDefault();
        revealPassword();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();

        if (!filtered.length) return;

        const index = Math.max(0, filtered.findIndex((entry) => entry.id === selected?.id));
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(filtered.length - 1, Math.max(0, index + delta));
        setSelectedId(filtered[next].id);
        return;
      }

      if (event.key === "Escape") {
        setShowPassword(false);
        setRevealedPassword("");
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    copyField,
    createVaultOpen,
    editorOpen,
    filtered,
    lockVault,
    revealPassword,
    selected?.id,
    settings.shortcuts,
    settingsOpen,
    startEditEntry,
    startNewEntry,
    unlocked
  ]);

  async function pickVault() {
    const result = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "KeePass database", extensions: ["kdbx", "kdb"] }]
    });

    if (typeof result === "string") {
      setVaultPath(result);
      setError("");
    }
  }

  async function unlock() {
    if (!vaultPath) {
      setError("Сначала выбери файл .kdbx");
      return;
    }

    if (!masterPassword) {
      setError("Введи мастер-пароль");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await applySecuritySettings(settings);

      const result = await invoke<OpenVaultResponse>("open_vault", {
        path: vaultPath,
        password: masterPassword
      });

      rememberVault(vaultPath);
      setEntries(result.entries);
      setSelectedId(result.entries[0]?.id ?? "");
      setDatabaseVersion(result.databaseVersion);
      setWriteSupported(result.writeSupported);
      setMasterPassword("");
      setUnlocked(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createVault(path: string, password: string) {
    const nextSettings: AppSettings = {
      ...settings,
      experimentalWrites: true
    };

    await applySecuritySettings(nextSettings);

    const result = await invoke<CreateVaultResponse>("create_vault", {
      path,
      password
    });

    saveSettings(nextSettings);
    setSettings(nextSettings);
    rememberVault(result.path);
    setEntries(result.entries);
    setSelectedId(result.entries[0]?.id ?? "");
    setDatabaseVersion(result.databaseVersion);
    setWriteSupported(result.writeSupported);
    setUnlocked(true);
    setCreateVaultOpen(false);
    setError("");
  }

  async function saveEntry(draft: EntryDraft) {
    const result = await invoke<SaveEntryResponse>("save_entry", { draft });

    setEntries(result.entries);
    setSelectedId(result.selectedId);
    setBackupNotice(result.backupPath);
    setEditorOpen(false);
    setEditorDetail(null);
  }

  function updateSettings(next: AppSettings) {
    saveSettings(next);
    setSettings(next);
    setSettingsOpen(false);
  }

  function secondaryEntryText(entry: VaultEntryMeta) {
    if (settings.visibleFields.username && entry.username) return entry.username;
    if (settings.visibleFields.url && entry.url) return domain(entry.url);
    return "Запись";
  }

  if (!unlocked) {
    return (
      <main className="unlock-page">
        <section className="unlock-card">
          <div className="brand-mark"><ShieldCheck size={28} /></div>

          <div className="unlock-copy">
            <span className="eyebrow">LOCAL PASSWORD VAULT</span>
            <h1>Открой свой Vault</h1>
            <p>KDBX расшифровывается в Rust. Весь набор паролей никогда не передаётся в React.</p>
          </div>

          <button className="file-picker" type="button" onClick={pickVault}>
            <span className="file-icon"><FileKey2 size={22} /></span>

            <span className="file-copy">
              <b>{vaultPath ? shortName(vaultPath) : "Выбрать базу KeePass"}</b>
              <small>
                {vaultPath
                  ? `${vaultPath}${localStorage.getItem(LAST_VAULT_KEY) === vaultPath ? " · последняя база" : ""}`
                  : "Файл .kdbx остаётся на компьютере"}
              </small>
            </span>

            <span className="file-action">{vaultPath ? "Изменить" : "Выбрать"}</span>
          </button>

          <label className="field-label">
            Мастер-пароль

            <div className="password-input">
              <KeyRound size={18} />

              <input
                type="password"
                value={masterPassword}
                autoFocus
                autoComplete="current-password"
                placeholder="Введите мастер-пароль"
                onChange={(e) => setMasterPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && unlock()}
              />
            </div>
          </label>

          {error && <div className="error-box">{error}</div>}

          <button className="primary-button" type="button" disabled={busy} onClick={unlock}>
            <LockKeyhole size={18} />
            {busy ? "Открываю…" : "Открыть Vault"}
          </button>

          <div className="unlock-secondary-actions">
            <button type="button" className="unlock-settings-button" onClick={() => setCreateVaultOpen(true)}>
              <Database size={16} /> Создать новую базу
            </button>

            <button type="button" className="unlock-settings-button" onClick={() => setSettingsOpen(true)}>
              <Settings size={16} /> Безопасность и хоткеи
            </button>
          </div>

          {settingsOpen && (
            <SettingsModal
              settings={settings}
              onSave={updateSettings}
              onClose={() => setSettingsOpen(false)}
            />
          )}

          {createVaultOpen && (
            <CreateVaultModal
              onCreate={createVault}
              onClose={() => setCreateVaultOpen(false)}
            />
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="mini-logo"><ShieldCheck size={20} /></div>

          <div>
            <b>Vault</b>
            <small>{shortName(vaultPath)}</small>
          </div>
        </div>

        <nav className="nav" aria-label="Основная навигация">
          <button className="nav-item active" type="button">
            <KeyRound size={18} />
            Все записи
            <span>{entries.length}</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="safe-status">
            <ShieldCheck size={17} />

            <div>
              <b>{databaseVersion || "KDBX"}</b>
              <small>{writeSupported ? "Backup перед записью" : "Только чтение"}</small>
            </div>
          </div>

          <button className="lock-button" type="button" onClick={() => setSettingsOpen(true)}>
            <Settings size={18} /> Настройки
          </button>

          <button className="lock-button" type="button" onClick={lockVault}>
            <LockKeyhole size={18} /> Заблокировать
          </button>
        </div>
      </aside>

      <section className="list-panel">
        <header className="list-header">
          <div className="list-title-row">
            <div>
              <span className="eyebrow">PASSWORDS</span>
              <h2>Все записи</h2>
            </div>

            <button
              type="button"
              className="add-button"
              onClick={startNewEntry}
              disabled={!writeSupported}
              title={
                !writeSupported
                  ? "Запись доступна только для KDBX4"
                  : settings.experimentalWrites
                    ? "Новая запись"
                    : "Нажми, чтобы включить запись в настройках"
              }
            >
              <Plus size={18} />
            </button>
          </div>

          <div className="search-box">
            <Search size={18} />

            <input
              ref={searchRef}
              value={query}
              placeholder="Поиск…"
              onChange={(e) => setQuery(e.target.value)}
            />

            {query && (
              <button type="button" className="icon-button compact" onClick={() => setQuery("")}>
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        <div className="entry-list" role="listbox" aria-label="Записи">
          {filtered.map((entry) => (
            <button
              type="button"
              role="option"
              aria-selected={selected?.id === entry.id}
              key={entry.id}
              className={`entry-row ${selected?.id === entry.id ? "selected" : ""}`}
              onClick={() => setSelectedId(entry.id)}
            >
              <span className="entry-avatar">{initials(entry)}</span>

              <span className="entry-main">
                <b>{entry.title || "Без названия"}</b>
                <small>{secondaryEntryText(entry)}</small>
              </span>
            </button>
          ))}

          {!entries.length && !query && (
            <div className="empty-state empty-vault-state">
              <Database size={28} />
              <b>База пока пустая</b>
              <span>Создай первую запись.</span>

              <button type="button" className="secondary-button" onClick={startNewEntry}>
                <Plus size={16} /> Новая запись
              </button>
            </div>
          )}

          {!!entries.length && !filtered.length && (
            <div className="empty-state">
              <Search size={26} />
              <b>Ничего не найдено</b>
              <span>Попробуй другой запрос.</span>
            </div>
          )}
        </div>
      </section>

      <section className="detail-panel">
        {selected && detail ? (
          <>
            <header className="detail-header">
              <div className="hero-avatar">{initials(selected)}</div>

              <div className="hero-copy">
                <span className="eyebrow">ENTRY</span>
                <h2>{selected.title || "Без названия"}</h2>
                <span>{domain(selected.url) || "KeePass entry"}</span>
              </div>

              <button
                type="button"
                className="secondary-button edit-button"
                onClick={startEditEntry}
                disabled={!writeSupported}
              >
                <Pencil size={16} /> Изменить
              </button>
            </header>

            <div className="detail-scroll">
              <div className="detail-body">
                {settings.visibleFields.username && (
                  <ValueRow
                    icon={<UserRound size={18} />}
                    label="Логин"
                    value={selected.username}
                    copied={copied === "login"}
                    shortcut={settings.shortcuts.copyUsername}
                    onCopy={() => copyField("username", "login")}
                  />
                )}

                {settings.visibleFields.password && (
                  <div className="value-card">
                    <div className="value-icon"><KeyRound size={18} /></div>

                    <div className="value-content">
                      <span>Пароль</span>
                      <b className="password-value">
                        {!selected.hasPassword
                          ? "—"
                          : showPassword
                            ? revealedPassword
                            : "••••••••••••••••"}
                      </b>
                    </div>

                    {selected.hasPassword && (
                      <>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={revealPassword}
                          title="Показать / скрыть"
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>

                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => copyField("password", "password")}
                          title={`Копировать пароль (${settings.shortcuts.copyPassword})`}
                        >
                          {copied === "password" ? <Check size={18} /> : <Clipboard size={18} />}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {settings.visibleFields.url && (
                  <ValueRow
                    icon={<Globe2 size={18} />}
                    label="Сайт"
                    value={selected.url}
                    copied={copied === "url"}
                    shortcut={settings.shortcuts.copyUrl}
                    onCopy={() => copyField("url", "url")}
                  />
                )}

                {settings.visibleFields.email && (
                  <ValueRow
                    icon={<Mail size={18} />}
                    label="Email"
                    value={detail.email}
                    copied={copied === "email"}
                    onCopy={() => copyField("email", "email")}
                  />
                )}

                {settings.visibleFields.phone && (
                  <ValueRow
                    icon={<Phone size={18} />}
                    label="Телефон"
                    value={detail.phone}
                    copied={copied === "phone"}
                    onCopy={() => copyField("phone", "phone")}
                  />
                )}

                {settings.visibleFields.tags && !!detail.tags.length && (
                  <div className="section-card">
                    <div className="section-title"><Tag size={17} /> Теги</div>

                    <div className="tags">
                      {detail.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </div>
                )}

                {settings.visibleFields.description && !!detail.description && (
                  <div className="section-card">
                    <div className="section-title">Описание</div>
                    <p className="notes">{detail.description}</p>
                  </div>
                )}

                {settings.visibleFields.notes && !!detail.notes && (
                  <div className="section-card">
                    <div className="section-title">Заметки</div>
                    <p className="notes">{detail.notes}</p>
                  </div>
                )}

                <div className="clipboard-info">
                  <Clipboard size={16} />
                  Clipboard очищается через 30 секунд только если его содержимое не изменилось.
                </div>

                {backupNotice && (
                  <div className="backup-notice">
                    Последний backup: <span>{backupNotice}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="empty-detail">
            {entries.length ? "Выбери запись слева." : "Создай первую запись в этой базе."}
          </div>
        )}
      </section>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onSave={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {editorOpen && (
        <EntryEditor
          detail={editorDetail}
          onSave={saveEntry}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </main>
  );
}

function ValueRow({
  icon,
  label,
  value,
  copied,
  shortcut,
  onCopy
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  copied: boolean;
  shortcut?: string;
  onCopy: () => void;
}) {
  return (
    <div className="value-card">
      <div className="value-icon">{icon}</div>

      <div className="value-content">
        <span>{label}</span>
        <b>{value || "—"}</b>
      </div>

      {shortcut && value && <kbd className="inline-shortcut">{shortcut}</kbd>}

      {!!value && (
        <button className="icon-button" type="button" title={`Копировать ${label}`} onClick={onCopy}>
          {copied ? <Check size={18} /> : <Clipboard size={18} />}
        </button>
      )}
    </div>
  );
}
