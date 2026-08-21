import { useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Database, Eye, EyeOff, FilePlus2, ShieldAlert, X } from "lucide-react";

export default function CreateVaultModal({
  onCreate,
  onClose
}: {
  onCreate: (path: string, password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function choosePath() {
    const result = await saveDialog({
      defaultPath: "vault.kdbx",
      filters: [{ name: "KeePass database", extensions: ["kdbx"] }]
    });

    if (typeof result === "string") {
      setPath(result);
      setError("");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!path) {
      setError("Выбери, куда сохранить новую базу.");
      return;
    }

    if (password.length < 12) {
      setError("Для мастер-пароля используй минимум 12 символов.");
      return;
    }

    if (password !== confirmation) {
      setError("Мастер-пароли не совпадают.");
      return;
    }

    if (!acknowledged) {
      setError("Нужно подтвердить предупреждение о KDBX writer.");
      return;
    }

    setCreating(true);
    setError("");

    try {
      await onCreate(path, password);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal create-vault-modal" role="dialog" aria-modal="true" onSubmit={submit}>
        <header className="modal-header">
          <div>
            <span className="eyebrow">NEW DATABASE</span>
            <h2>Создать свою базу</h2>
          </div>

          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </header>

        <div className="modal-scroll form-scroll">
          <div className="create-database-hero">
            <Database size={25} />
            <div>
              <b>Новая локальная KDBX 4.1</b>
              <span>База создаётся сразу в стандартном формате KeePass и открывается в Vault после проверки.</span>
            </div>
          </div>

          <button className="file-picker" type="button" onClick={choosePath}>
            <span className="file-icon"><FilePlus2 size={21} /></span>
            <span className="file-copy">
              <b>{path ? path.split(/[\\/]/).pop() : "Выбрать имя и папку"}</b>
              <small>{path || "Например: Documents\\Vault\\passwords.kdbx"}</small>
            </span>
            <span className="file-action">{path ? "Изменить" : "Выбрать"}</span>
          </button>

          <label className="field-label">
            Мастер-пароль
            <div className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="new-password"
                placeholder="Минимум 12 символов"
                onChange={(e) => setPassword(e.target.value)}
              />
              <button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>

          <label className="field-label">
            Повтори мастер-пароль
            <div className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                value={confirmation}
                autoComplete="new-password"
                placeholder="Повтори мастер-пароль"
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
          </label>

          <label className="toggle-row dangerous-toggle create-warning-toggle">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              <b><ShieldAlert size={14} /> Понимаю, что запись KDBX4 пока экспериментальная</b>
              <small>Созданный файл повторно открывается и проверяется до того, как Vault считает создание успешным.</small>
            </span>
          </label>

          {error && <div className="error-box">{error}</div>}
        </div>

        <footer className="modal-footer">
          <button type="button" className="secondary-button" onClick={onClose}>Отмена</button>

          <button
            type="submit"
            className="primary-button modal-primary"
            disabled={creating || !acknowledged}
          >
            {creating ? "Создаю…" : "Создать и открыть"}
          </button>
        </footer>
      </form>
    </div>
  );
}
