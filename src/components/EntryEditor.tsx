import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, ShieldAlert, X } from "lucide-react";
import type { EntryDetail, EntryDraft } from "../types";

function securePassword(length: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const result: string[] = [];
  const max = 256 - (256 % alphabet.length);
  const buffer = new Uint8Array(Math.max(length * 2, 64));

  while (result.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte < max) result.push(alphabet[byte % alphabet.length]);
      if (result.length === length) break;
    }
  }

  return result.join("");
}

export default function EntryEditor({
  detail,
  onSave,
  onClose
}: {
  detail: EntryDetail | null;
  onSave: (draft: EntryDraft) => Promise<void>;
  onClose: () => void;
}) {
  const isNew = detail === null;
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLength, setPasswordLength] = useState(24);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const initial = useMemo<EntryDraft>(() => ({
    id: detail?.id ?? null,
    title: detail?.title ?? "",
    username: detail?.username ?? "",
    password: "",
    replacePassword: isNew,
    url: detail?.url ?? "",
    email: detail?.email ?? "",
    phone: detail?.phone ?? "",
    description: detail?.description ?? "",
    notes: detail?.notes ?? "",
    tags: detail?.tags ?? []
  }), [detail, isNew]);

  const [draft, setDraft] = useState<EntryDraft>(initial);

  useEffect(() => setDraft(initial), [initial]);

  function update<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!draft.title.trim()) {
      setError("У записи должно быть название.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await onSave({
        ...draft,
        title: draft.title.trim(),
        tags: draft.tags.map((tag) => tag.trim()).filter(Boolean)
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal entry-modal" role="dialog" aria-modal="true" onSubmit={submit}>
        <header className="modal-header">
          <div>
            <span className="eyebrow">{isNew ? "NEW ENTRY" : "EDIT ENTRY"}</span>
            <h2>{isNew ? "Новая запись" : "Редактировать запись"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>

        <div className="modal-scroll form-scroll">
          <div className="write-warning">
            <ShieldAlert size={18} />
            <div>
              <b>Перед каждой записью создаётся резервная копия KDBX</b>
              <span>Затем временный файл заново открывается и только после проверки атомарно заменяет исходный файл.</span>
            </div>
          </div>

          <div className="form-grid">
            <label className="span-2">
              Название *
              <input autoFocus value={draft.title} onChange={(e) => update("title", e.target.value)} placeholder="GitHub" />
            </label>

            <label>
              Логин
              <input value={draft.username} onChange={(e) => update("username", e.target.value)} placeholder="user@example.com" />
            </label>

            <label>
              Email
              <input type="email" value={draft.email} onChange={(e) => update("email", e.target.value)} placeholder="mail@example.com" />
            </label>

            <label className="span-2">
              URL
              <input value={draft.url} onChange={(e) => update("url", e.target.value)} placeholder="https://example.com" />
            </label>

            <label>
              Телефон
              <input value={draft.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+7 ..." />
            </label>

            <label>
              Теги
              <input
                value={draft.tags.join(", ")}
                onChange={(e) => update("tags", e.target.value.split(","))}
                placeholder="work, server"
              />
            </label>

            <fieldset className="password-editor span-2">
              <legend>Пароль</legend>

              {!isNew && (
                <label className="toggle-row compact-toggle">
                  <input
                    type="checkbox"
                    checked={draft.replacePassword}
                    onChange={(e) => update("replacePassword", e.target.checked)}
                  />
                  <span>
                    <b>Изменить пароль</b>
                    <small>Если выключено, текущий пароль вообще не передаётся в форму.</small>
                  </span>
                </label>
              )}

              {(isNew || draft.replacePassword) && (
                <>
                  <div className="password-edit-row">
                    <div className="editor-password-input">
                      <KeyRound size={17} />
                      <input
                        type={showPassword ? "text" : "password"}
                        value={draft.password}
                        onChange={(e) => update("password", e.target.value)}
                        placeholder="Новый пароль"
                        autoComplete="new-password"
                      />
                      <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>

                    <button
                      type="button"
                      className="secondary-button generate-button"
                      onClick={() => {
                        update("password", securePassword(passwordLength));
                        setShowPassword(false);
                      }}
                    >
                      <RefreshCw size={16} /> Сгенерировать
                    </button>
                  </div>

                  <div className="generator-row">
                    <span>Длина: {passwordLength}</span>
                    <input
                      type="range"
                      min={16}
                      max={64}
                      value={passwordLength}
                      onChange={(e) => setPasswordLength(Number(e.target.value))}
                    />
                  </div>
                </>
              )}
            </fieldset>

            <label className="span-2">
              Описание
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Короткое описание записи"
              />
            </label>

            <label className="span-2">
              Заметки
              <textarea
                rows={5}
                value={draft.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Дополнительная информация"
              />
            </label>
          </div>

          {error && <div className="error-box">{error}</div>}
        </div>

        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>Отмена</button>
          <button type="submit" className="primary-button modal-primary" disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить в KDBX"}
          </button>
        </footer>
      </form>
    </div>
  );
}
