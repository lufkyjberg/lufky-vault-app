use keepass::{
    config::DatabaseVersion,
    db::EntryId,
    Database,
    DatabaseKey,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;
use zeroize::Zeroizing;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct VaultEntryMeta {
    id: String,
    title: String,
    username: String,
    url: String,
    tags: Vec<String>,
    has_password: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryDetail {
    id: String,
    title: String,
    username: String,
    url: String,
    email: String,
    phone: String,
    description: String,
    notes: String,
    tags: Vec<String>,
    has_password: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenVaultResponse {
    entries: Vec<VaultEntryMeta>,
    database_version: String,
    write_supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateVaultResponse {
    path: String,
    entries: Vec<VaultEntryMeta>,
    database_version: String,
    write_supported: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveEntryResponse {
    entries: Vec<VaultEntryMeta>,
    selected_id: String,
    backup_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryDraft {
    id: Option<String>,
    title: String,
    username: String,
    password: String,
    replace_password: bool,
    url: String,
    email: String,
    phone: String,
    description: String,
    notes: String,
    tags: Vec<String>,
}

struct VaultSession {
    path: PathBuf,
    master_password: Zeroizing<String>,
    database: Database,
    database_version: DatabaseVersion,
    last_activity: Instant,
}

#[derive(Clone, Copy)]
struct SecuritySettings {
    auto_lock_seconds: u64,
    lock_on_blur: bool,
    lock_on_secure_desktop: bool,
    content_protection: bool,
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            auto_lock_seconds: 300,
            lock_on_blur: false,
            lock_on_secure_desktop: true,
            content_protection: true,
        }
    }
}

#[derive(Default)]
struct VaultState {
    session: Mutex<Option<VaultSession>>,
    security: Mutex<SecuritySettings>,
}

fn list_entries(database: &Database) -> Vec<VaultEntryMeta> {
    database
        .iter_all_entries()
        .map(|entry| VaultEntryMeta {
            id: entry.id().to_string(),
            title: entry.get_title().unwrap_or("").to_string(),
            username: entry.get_username().unwrap_or("").to_string(),
            url: entry.get_url().unwrap_or("").to_string(),
            tags: entry.tags.clone(),
            has_password: entry.get_password().map(|value| !value.is_empty()).unwrap_or(false),
        })
        .collect()
}

fn parse_entry_id(id: &str) -> Result<EntryId, String> {
    let uuid = Uuid::parse_str(id).map_err(|_| "Некорректный ID записи.".to_string())?;
    Ok(EntryId::from_uuid(uuid))
}

fn lock_internal(app: &tauri::AppHandle, emit_event: bool) -> bool {
    let state = app.state::<VaultState>();
    let had_session = match state.session.lock() {
        Ok(mut session) => session.take().is_some(),
        Err(_) => false,
    };

    let _ = app.clipboard().clear();

    if had_session && emit_event {
        let _ = app.emit("vault-locked", ());
    }

    had_session
}

fn read_database(path: &Path, password: &str) -> Result<Database, String> {
    let mut file = File::open(path).map_err(|e| format!("Не удалось открыть KDBX: {e}"))?;
    let key = DatabaseKey::new().with_password(password);

    Database::open(&mut file, key)
        .map_err(|_| "Не удалось расшифровать базу. Проверь мастер-пароль и файл.".to_string())
}

fn backup_database(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or_else(|| "Не удалось определить папку базы.".to_string())?;
    let backup_dir = parent.join("vault-backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Не удалось создать папку backup: {e}"))?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("vault.kdbx");

    let backup_path = backup_dir.join(format!("{file_name}.{stamp}.bak"));
    fs::copy(path, &backup_path)
        .map_err(|e| format!("Не удалось создать backup перед записью: {e}"))?;

    Ok(backup_path)
}

#[cfg(windows)]
fn atomic_replace(temp_path: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    let temp_wide: Vec<u16> = temp_path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    let result = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temp_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };

    if result == 0 {
        return Err(format!(
            "Windows не смог атомарно заменить KDBX: {}",
            std::io::Error::last_os_error()
        ));
    }

    Ok(())
}

#[cfg(unix)]
fn atomic_replace(temp_path: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temp_path, destination)
        .map_err(|e| format!("Не удалось заменить KDBX: {e}"))?;

    let parent = destination
        .parent()
        .ok_or_else(|| "Не удалось определить папку базы после замены.".to_string())?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("KDBX заменён, но не удалось синхронизировать его папку: {e}"))
}

#[cfg(not(any(windows, unix)))]
fn atomic_replace(temp_path: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temp_path, destination)
        .map_err(|e| format!("Не удалось заменить KDBX: {e}"))
}

fn save_database_safely(session: &mut VaultSession) -> Result<PathBuf, String> {
    if !matches!(&session.database_version, DatabaseVersion::KDB4(_)) {
        return Err("Запись разрешена только для KDBX4.".to_string());
    }

    // Защитная нормализация на случай повторной загрузки базы в память.
    // Writer поддерживает KDBX 4.1; ниже перед записью создаётся резервная копия исходника.
    session.database.config.version = DatabaseVersion::KDB4(1);

    let backup_path = backup_database(&session.path)?;
    let parent = session
        .path
        .parent()
        .ok_or_else(|| "Не удалось определить папку базы.".to_string())?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let file_name = session
        .path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("vault.kdbx");

    let temp_path = parent.join(format!(".{file_name}.vault-{stamp}.tmp"));

    let save_result = (|| -> Result<(), String> {
        let mut temp_file = File::create(&temp_path)
            .map_err(|e| format!("Не удалось создать временный KDBX: {e}"))?;

        let key = DatabaseKey::new().with_password(session.master_password.as_str());
        session
            .database
            .save(&mut temp_file, key)
            .map_err(|e| format!("Ошибка записи KDBX: {e}"))?;

        temp_file
            .sync_all()
            .map_err(|e| format!("Не удалось синхронизировать временный KDBX: {e}"))?;
        drop(temp_file);

        let mut verify_file = File::open(&temp_path)
            .map_err(|e| format!("Не удалось открыть временный KDBX для проверки: {e}"))?;

        Database::open(
            &mut verify_file,
            DatabaseKey::new().with_password(session.master_password.as_str()),
        )
        .map_err(|_| "Проверка сохранённого KDBX не прошла. Исходный файл не изменён.".to_string())?;

        // ReplaceFileW не может заменить временный файл, пока открыт дескриптор его проверки.
        drop(verify_file);
        atomic_replace(&temp_path, &session.path)?;
        Ok(())
    })();

    if let Err(error) = save_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(backup_path)
}

fn reload_session_database(session: &mut VaultSession) {
    if let Ok(database) = read_database(&session.path, session.master_password.as_str()) {
        session.database = database;
        session.last_activity = Instant::now();
    }
}


#[cfg(windows)]
fn is_normal_input_desktop() -> bool {
    use std::ffi::c_void;
    use windows_sys::Win32::System::{
        StationsAndDesktops::{GetThreadDesktop, GetUserObjectInformationW, UOI_IO},
        Threading::GetCurrentThreadId,
    };

    let desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
    if desktop.is_null() {
        return false;
    }

    let mut is_input: i32 = 0;
    let mut needed: u32 = 0;

    let ok = unsafe {
        GetUserObjectInformationW(
            desktop as _,
            UOI_IO,
            &mut is_input as *mut _ as *mut c_void,
            std::mem::size_of::<i32>() as u32,
            &mut needed,
        )
    };

    ok != 0 && is_input != 0
}

#[cfg(not(windows))]
fn is_normal_input_desktop() -> bool {
    true
}

#[cfg(windows)]
fn set_window_content_protection(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_content_protected(enabled)
            .map_err(|e| format!("Не удалось изменить защиту захвата окна: {e}"))?;
    }

    Ok(())
}

#[cfg(not(windows))]
fn set_window_content_protection(_app: &tauri::AppHandle, _enabled: bool) -> Result<(), String> {
    // Защита содержимого Tauri не является переносимой границей защиты от захвата на Linux.
    Ok(())
}

#[tauri::command]
fn configure_security(
    app: tauri::AppHandle,
    auto_lock_seconds: u64,
    lock_on_blur: bool,
    lock_on_secure_desktop: bool,
    content_protection: bool,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    {
        let mut security = state
            .security
            .lock()
            .map_err(|_| "Не удалось изменить настройки безопасности.".to_string())?;

        security.auto_lock_seconds = auto_lock_seconds.clamp(60, 86_400);
        security.lock_on_blur = lock_on_blur;
        security.lock_on_secure_desktop = lock_on_secure_desktop;
        security.content_protection = content_protection;
    }

    set_window_content_protection(&app, content_protection)
}

fn normalize_new_vault_path(path: &str) -> PathBuf {
    let mut path = PathBuf::from(path);

    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.eq_ignore_ascii_case("kdbx"))
        .unwrap_or(true)
    {
        path.set_extension("kdbx");
    }

    path
}

fn create_database_file(path: &Path, password: &str) -> Result<Database, String> {
    if path.exists() {
        return Err("Файл уже существует. Для новой базы выбери другое имя.".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Не удалось определить папку новой базы.".to_string())?;

    if !parent.exists() {
        return Err("Выбранная папка не существует.".to_string());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("vault.kdbx");
    let temp_path = parent.join(format!(".{file_name}.create-{stamp}.tmp"));

    let creation_result = (|| -> Result<Database, String> {
        let mut database = Database::new();
        database.config.version = DatabaseVersion::KDB4(1);

        let mut temp_file = File::create(&temp_path)
            .map_err(|e| format!("Не удалось создать временный KDBX: {e}"))?;

        database
            .save(
                &mut temp_file,
                DatabaseKey::new().with_password(password),
            )
            .map_err(|e| format!("Не удалось создать KDBX: {e}"))?;

        temp_file
            .sync_all()
            .map_err(|e| format!("Не удалось синхронизировать новый KDBX: {e}"))?;
        drop(temp_file);

        let verified = read_database(&temp_path, password)
            .map_err(|_| "Новая база записалась, но не прошла проверку повторным открытием.".to_string())?;

        fs::rename(&temp_path, path)
            .map_err(|e| format!("Не удалось переместить проверенный KDBX на выбранный путь: {e}"))?;

        Ok(verified)
    })();

    if creation_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    creation_result
}

#[tauri::command]
fn create_vault(
    path: String,
    password: String,
    state: State<'_, VaultState>,
) -> Result<CreateVaultResponse, String> {
    let password = Zeroizing::new(password);

    if password.chars().count() < 12 {
        return Err("Мастер-пароль должен содержать минимум 12 символов.".to_string());
    }

    let path = normalize_new_vault_path(&path);
    let mut database = create_database_file(&path, password.as_str())?;

    database.config.version = DatabaseVersion::KDB4(1);

    let database_version = DatabaseVersion::KDB4(1);
    let entries = list_entries(&database);

    let session = VaultSession {
        path: path.clone(),
        master_password: password,
        database,
        database_version,
        last_activity: Instant::now(),
    };

    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;

    *guard = Some(session);

    Ok(CreateVaultResponse {
        path: path.to_string_lossy().into_owned(),
        entries,
        database_version: DatabaseVersion::KDB4(1).to_string(),
        write_supported: true,
    })
}

#[tauri::command]
fn open_vault(
    path: String,
    password: String,
    state: State<'_, VaultState>,
) -> Result<OpenVaultResponse, String> {
    let password = Zeroizing::new(password);
    let path = PathBuf::from(path);

    let mut version_file = File::open(&path)
        .map_err(|e| format!("Не удалось открыть файл: {e}"))?;

    let database_version = Database::get_version(&mut version_file)
        .map_err(|e| format!("Не удалось определить версию KDBX: {e}"))?;

    let mut database = read_database(&path, password.as_str())?;
    let entries = list_entries(&database);
    let write_supported = matches!(&database_version, DatabaseVersion::KDB4(_));
    let database_version_label = database_version.to_string();

    // keepass-rs предоставляет writer KDBX 4.1. Нормализуем только целевую версию
    // в памяти; исходный файл не меняется до успешной проверки сохранённой копии.
    if write_supported {
        database.config.version = DatabaseVersion::KDB4(1);
    }

    let session = VaultSession {
        path,
        master_password: password,
        database,
        database_version,
        last_activity: Instant::now(),
    };

    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;
    *guard = Some(session);

    Ok(OpenVaultResponse {
        entries,
        database_version: database_version_label,
        write_supported,
    })
}

#[tauri::command]
fn touch_activity(state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;

    if let Some(session) = guard.as_mut() {
        session.last_activity = Instant::now();
    }

    Ok(())
}

#[tauri::command]
fn get_entry_detail(id: String, state: State<'_, VaultState>) -> Result<EntryDetail, String> {
    let entry_id = parse_entry_id(&id)?;
    let guard = state
        .session
        .lock()
        .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;

    let session = guard
        .as_ref()
        .ok_or_else(|| "Vault заблокирован.".to_string())?;

    let entry = session
        .database
        .entry(entry_id)
        .ok_or_else(|| "Запись не найдена.".to_string())?;

    Ok(EntryDetail {
        id,
        title: entry.get_title().unwrap_or("").to_string(),
        username: entry.get_username().unwrap_or("").to_string(),
        url: entry.get_url().unwrap_or("").to_string(),
        email: entry.get("Email").unwrap_or("").to_string(),
        phone: entry.get("Phone").unwrap_or("").to_string(),
        description: entry.get("Description").unwrap_or("").to_string(),
        notes: entry.get("Notes").unwrap_or("").to_string(),
        tags: entry.tags.clone(),
        has_password: entry.get_password().map(|value| !value.is_empty()).unwrap_or(false),
    })
}

#[tauri::command]
fn get_password(id: String, state: State<'_, VaultState>) -> Result<String, String> {
    let entry_id = parse_entry_id(&id)?;
    let guard = state
        .session
        .lock()
        .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;

    let session = guard
        .as_ref()
        .ok_or_else(|| "Vault заблокирован.".to_string())?;

    let entry = session
        .database
        .entry(entry_id)
        .ok_or_else(|| "Запись не найдена.".to_string())?;

    Ok(entry.get_password().unwrap_or("").to_string())
}

#[tauri::command]
fn copy_entry_field(
    app: tauri::AppHandle,
    id: String,
    field: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    let entry_id = parse_entry_id(&id)?;

    let value = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;

        let session = guard
            .as_ref()
            .ok_or_else(|| "Vault заблокирован.".to_string())?;

        let entry = session
            .database
            .entry(entry_id)
            .ok_or_else(|| "Запись не найдена.".to_string())?;

        let source = match field.as_str() {
            "username" => entry.get_username().unwrap_or(""),
            "password" => entry.get_password().unwrap_or(""),
            "url" => entry.get_url().unwrap_or(""),
            "email" => entry.get("Email").unwrap_or(""),
            "phone" => entry.get("Phone").unwrap_or(""),
            _ => return Err("Неизвестное поле для копирования.".to_string()),
        };

        Zeroizing::new(source.to_string())
    };

    if value.is_empty() {
        return Ok(());
    }

    let hash = Sha256::digest(value.as_bytes()).to_vec();

    app.clipboard()
        .write_text(value.as_str())
        .map_err(|e| format!("Не удалось скопировать в clipboard: {e}"))?;

    let app_handle = app.clone();

    thread::spawn(move || {
        thread::sleep(Duration::from_secs(30));

        if let Ok(current) = app_handle.clipboard().read_text() {
            let current = Zeroizing::new(current);
            let current_hash = Sha256::digest(current.as_bytes());

            if current_hash.as_slice() == hash.as_slice() {
                let _ = app_handle.clipboard().clear();
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn save_entry(
    draft: EntryDraft,
    state: State<'_, VaultState>,
) -> Result<SaveEntryResponse, String> {
    if draft.title.trim().is_empty() {
        return Err("Название записи не может быть пустым.".to_string());
    }

    let password = Zeroizing::new(draft.password);

    let mut guard = state
        .session
        .lock()
        .map_err(|_| "Внутренняя ошибка Vault state.".to_string())?;

    let session = guard
        .as_mut()
        .ok_or_else(|| "Vault заблокирован.".to_string())?;

    if !matches!(&session.database_version, DatabaseVersion::KDB4(_)) {
        return Err("Эта база поддерживается только для чтения.".to_string());
    }

    let selected_id = if let Some(id) = draft.id.as_deref() {
        let entry_id = parse_entry_id(id)?;
        let mut entry = session
            .database
            .entry_mut(entry_id)
            .ok_or_else(|| "Запись не найдена.".to_string())?;

        entry.edit_tracking(|tracked| {
            tracked.set_unprotected("Title", draft.title.clone());
            tracked.set_unprotected("UserName", draft.username.clone());
            tracked.set_unprotected("URL", draft.url.clone());
            tracked.set_unprotected("Email", draft.email.clone());
            tracked.set_unprotected("Phone", draft.phone.clone());
            tracked.set_unprotected("Description", draft.description.clone());
            tracked.set_unprotected("Notes", draft.notes.clone());
            tracked.tags = draft.tags.clone();

            if draft.replace_password {
                tracked.set_protected("Password", password.as_str());
            }
        });

        id.to_string()
    } else {
        let mut root = session.database.root_mut();
        let mut entry = root.add_entry();
        entry.set_unprotected("Title", draft.title);
        entry.set_unprotected("UserName", draft.username);
        entry.set_unprotected("URL", draft.url);
        entry.set_unprotected("Email", draft.email);
        entry.set_unprotected("Phone", draft.phone);
        entry.set_unprotected("Description", draft.description);
        entry.set_unprotected("Notes", draft.notes);
        entry.set_protected("Password", password.as_str());
        entry.tags = draft.tags;
        entry.id().to_string()
    };

    let backup_path = match save_database_safely(session) {
        Ok(path) => path,
        Err(error) => {
            reload_session_database(session);
            return Err(error);
        }
    };

    session.last_activity = Instant::now();
    let entries = list_entries(&session.database);

    Ok(SaveEntryResponse {
        entries,
        selected_id,
        backup_path: backup_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn lock_vault(app: tauri::AppHandle) -> Result<(), String> {
    lock_internal(&app, false);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(VaultState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            configure_security,
            create_vault,
            open_vault,
            touch_activity,
            get_entry_detail,
            get_password,
            copy_entry_field,
            save_entry,
            lock_vault
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            if let Some(window) = app.get_webview_window("main") {
                let window_app = app_handle.clone();

                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(false) => {
                        let state = window_app.state::<VaultState>();
                        let should_lock = state
                            .security
                            .lock()
                            .map(|settings| settings.lock_on_blur)
                            .unwrap_or(false);

                        if should_lock {
                            lock_internal(&window_app, true);
                        }
                    }
                    WindowEvent::CloseRequested { .. } => {
                        lock_internal(&window_app, false);
                    }
                    _ => {}
                });
            }

            let timer_app = app_handle.clone();

            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(2));

                let state = timer_app.state::<VaultState>();
                let timeout = state
                    .security
                    .lock()
                    .map(|settings| settings.auto_lock_seconds)
                    .unwrap_or(300);

                let lock_on_secure_desktop = state
                    .security
                    .lock()
                    .map(|settings| settings.lock_on_secure_desktop)
                    .unwrap_or(true);

                let timed_out = state
                    .session
                    .lock()
                    .map(|session| {
                        session
                            .as_ref()
                            .map(|session| session.last_activity.elapsed() >= Duration::from_secs(timeout))
                            .unwrap_or(false)
                    })
                    .unwrap_or(false);

                let secure_desktop = lock_on_secure_desktop && !is_normal_input_desktop();

                if timed_out || secure_desktop {
                    lock_internal(&timer_app, true);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Vault");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const TEST_PASSWORD: &str = "correct horse battery staple";

    #[test]
    fn creates_and_reopens_kdbx4_database() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("vault.kdbx");
        let database = create_database_file(&path, TEST_PASSWORD).expect("create database");

        assert!(path.is_file());
        assert!(database.iter_all_entries().next().is_none());
        assert!(read_database(&path, TEST_PASSWORD).is_ok());
        assert!(read_database(&path, "wrong password").is_err());
    }

    #[test]
    fn create_refuses_to_overwrite_existing_database() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("vault.kdbx");

        create_database_file(&path, TEST_PASSWORD).expect("first create");
        let original = fs::read(&path).expect("read original database");
        let error = create_database_file(&path, TEST_PASSWORD).expect_err("overwrite must fail");

        assert!(error.contains("уже существует"));
        assert_eq!(fs::read(&path).expect("read preserved database"), original);
    }

    #[test]
    fn safe_save_creates_backup_and_persists_entry() {
        let directory = tempdir().expect("temporary directory");
        let path = directory.path().join("vault.kdbx");
        let mut database = create_database_file(&path, TEST_PASSWORD).expect("create database");

        {
            let mut root = database.root_mut();
            let mut entry = root.add_entry();
            entry.set_unprotected("Title", "Regression entry");
            entry.set_unprotected("UserName", "vault-user");
            entry.set_protected("Password", "test-secret");
        }

        let mut session = VaultSession {
            path: path.clone(),
            master_password: Zeroizing::new(TEST_PASSWORD.to_string()),
            database,
            database_version: DatabaseVersion::KDB4(1),
            last_activity: Instant::now(),
        };

        let backup_path = save_database_safely(&mut session).expect("safe save");
        let reopened = read_database(&path, TEST_PASSWORD).expect("reopen saved database");
        let backup = read_database(&backup_path, TEST_PASSWORD).expect("reopen backup");
        let saved_entry = reopened.iter_all_entries().next().expect("saved entry");

        assert_eq!(saved_entry.get_title(), Some("Regression entry"));
        assert_eq!(saved_entry.get_username(), Some("vault-user"));
        assert_eq!(saved_entry.get_password(), Some("test-secret"));
        assert!(backup.iter_all_entries().next().is_none());
        assert!(directory
            .path()
            .read_dir()
            .expect("read temporary directory")
            .all(|item| !item.expect("directory entry").file_name().to_string_lossy().ends_with(".tmp")));
    }
}
