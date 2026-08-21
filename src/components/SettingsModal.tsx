import { useEffect, useMemo, useState } from "react";
import { Eye, RotateCcw, ShieldCheck, X } from "lucide-react";
import {
  defaultSettings,
  displayFieldLabels,
  eventToShortcut,
  shortcutLabels
} from "../shortcuts";
import type { AppSettings, DisplayField, ShortcutAction } from "../types";

const actions = Object.keys(shortcutLabels) as ShortcutAction[];
const displayFields = Object.keys(displayFieldLabels) as DisplayField[];
const isWindows = navigator.userAgent.includes("Windows");

export default function SettingsModal({
  settings,
  onSave,
  onClose
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  const duplicateShortcuts = useMemo(() => {
    const values = Object.entries(draft.shortcuts).filter(([, value]) => value);
    const duplicates = new Set<string>();

    for (const [, value] of values) {
      if (values.filter(([, other]) => other === value).length > 1) duplicates.add(value);
    }

    return duplicates;
  }, [draft.shortcuts]);

  useEffect(() => {
    if (!recording) return;

    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(null);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        setDraft((current) => ({
          ...current,
          shortcuts: { ...current.shortcuts, [recording]: "" }
        }));
        setRecording(null);
        return;
      }

      const shortcut = eventToShortcut(event);
      if (!shortcut || ["Ctrl", "Alt", "Shift", "Meta"].includes(shortcut)) return;

      setDraft((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, [recording]: shortcut }
      }));
      setRecording(null);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Настройки">
        <header className="modal-header">
          <div>
            <span className="eyebrow">SETTINGS</span>
            <h2>Настройки</h2>
          </div>

          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>

        <div className="modal-scroll">
          <section className="settings-section">
            <div className="settings-heading">
              <ShieldCheck size={18} />
              <div>
                <b>Безопасность</b>
                <span>Настройки применяются сразу после сохранения.</span>
              </div>
            </div>

            <div className="settings-grid">
              <label>
                Автоблокировка
                <select
                  value={draft.autoLockMinutes}
                  onChange={(e) => setDraft({ ...draft, autoLockMinutes: Number(e.target.value) })}
                >
                  <option value={1}>1 минута</option>
                  <option value={5}>5 минут</option>
                  <option value={10}>10 минут</option>
                  <option value={15}>15 минут</option>
                  <option value={30}>30 минут</option>
                  <option value={60}>1 час</option>
                </select>
              </label>

              <label>
                Скрывать показанный пароль через
                <select
                  value={draft.revealSeconds}
                  onChange={(e) => setDraft({ ...draft, revealSeconds: Number(e.target.value) })}
                >
                  <option value={5}>5 секунд</option>
                  <option value={10}>10 секунд</option>
                  <option value={15}>15 секунд</option>
                  <option value={30}>30 секунд</option>
                </select>
              </label>
            </div>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.contentProtection}
                disabled={!isWindows}
                onChange={(e) => setDraft({ ...draft, contentProtection: e.target.checked })}
              />
              <span>
                <b>Защита окна от захвата</b>
                <small>{isWindows
                  ? "Просим Windows не отдавать содержимое Vault приложениям захвата экрана."
                  : "Системная защита захвата пока доступна только в Windows."}</small>
              </span>
            </label>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.lockOnSecureDesktop}
                disabled={!isWindows}
                onChange={(e) => setDraft({ ...draft, lockOnSecureDesktop: e.target.checked })}
              />
              <span>
                <b>Блокировать при Win+L / защищённом desktop</b>
                <small>{isWindows
                  ? "Vault блокируется при переходе Windows на secure desktop."
                  : "На Linux используй автоблокировку или блокировку при потере фокуса."}</small>
              </span>
            </label>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.lockOnBlur}
                onChange={(e) => setDraft({ ...draft, lockOnBlur: e.target.checked })}
              />
              <span>
                <b>Блокировать при любой потере фокуса</b>
                <small>Строгий режим: даже обычный Alt+Tab сразу блокирует Vault.</small>
              </span>
            </label>

            <label className="toggle-row dangerous-toggle">
              <input
                type="checkbox"
                checked={draft.experimentalWrites}
                onChange={(e) => setDraft({ ...draft, experimentalWrites: e.target.checked })}
              />
              <span>
                <b>Разрешить экспериментальную запись KDBX4</b>
                <small>Нужно для Add/Edit. Перед записью Vault делает backup и проверяет временный KDBX.</small>
              </span>
            </label>
          </section>

          <section className="settings-section">
            <div className="settings-heading">
              <Eye size={18} />
              <div>
                <b>Поля записи</b>
                <span>Выбери, какие поля показывать в правой панели. Название записи отображается всегда.</span>
              </div>
            </div>

            <div className="field-toggle-grid">
              {displayFields.map((field) => (
                <label className="field-toggle" key={field}>
                  <input
                    type="checkbox"
                    checked={draft.visibleFields[field]}
                    onChange={(e) => setDraft((current) => ({
                      ...current,
                      visibleFields: {
                        ...current.visibleFields,
                        [field]: e.target.checked
                      }
                    }))}
                  />
                  <span>{displayFieldLabels[field]}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-heading">
              <span className="keycap">⌨</span>
              <div>
                <b>Горячие клавиши</b>
                <span>Нажми на сочетание и введи новое. Delete — отключить, Esc — отмена.</span>
              </div>
            </div>

            <div className="shortcut-list">
              {actions.map((action) => {
                const value = draft.shortcuts[action];
                const duplicated = value !== "" && duplicateShortcuts.has(value);

                return (
                  <div className="shortcut-row" key={action}>
                    <span>{shortcutLabels[action]}</span>

                    <button
                      type="button"
                      className={`shortcut-recorder ${recording === action ? "recording" : ""} ${duplicated ? "invalid" : ""}`}
                      onClick={() => setRecording(action)}
                    >
                      {recording === action ? "Нажми клавиши…" : value || "Отключено"}
                    </button>
                  </div>
                );
              })}
            </div>

            {duplicateShortcuts.size > 0 && (
              <div className="warning-box">Одинаковое сочетание нельзя назначить двум действиям.</div>
            )}

            <button
              type="button"
              className="secondary-button inline-button"
              onClick={() => setDraft(defaultSettings)}
            >
              <RotateCcw size={16} /> Сбросить настройки
            </button>
          </section>

          <section className="settings-section muted-section">
            <b>Пользовательский CSS</b>
            <p>Основные переменные темы уже вынесены отдельно. Редактор пользовательского CSS добавим следующим этапом.</p>
          </section>
        </div>

        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>Отмена</button>

          <button
            type="button"
            className="primary-button modal-primary"
            disabled={duplicateShortcuts.size > 0}
            onClick={() => onSave(draft)}
          >
            Сохранить настройки
          </button>
        </footer>
      </section>
    </div>
  );
}
