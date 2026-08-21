# Vault — контекст проекта и история разработки

## 1. Что это за проект

**Vault** — личный desktop-менеджер паролей с современным интерфейсом, построенный поверх стандартного формата **KeePass KDBX**.

Основная цель проекта:

- получить визуально более приятный и удобный менеджер паролей, чем KeePass/KeePassXC;
- при этом **не изобретать собственный криптографический формат**;
- оставить совместимость со стандартными `.kdbx`;
- сделать приложение максимально локальным и автономным;
- постепенно добавить нормальную клавиатурную навигацию, hotkeys, Windows Hello, TOTP, browser extension, custom CSS и синхронизацию базы;
- не привязывать пользователя к приложению: база должна оставаться открываемой в KeePassXC и других KDBX-клиентах.

Проект ориентирован в первую очередь на Windows.

---

## 2. Главный архитектурный принцип

Мы сознательно разделяем UI и секреты.

### Неправильная схема

```text
KDBX
 ↓
Rust
 ↓
вся расшифрованная база
 ↓
React / WebView
```

Так было в самом первом MVP, но от этого отказались.

### Текущая целевая схема

```text
                    Rust
              ┌──────────────┐
KDBX ────────→│ Database     │
              │              │
              │ Passwords    │
              │ Notes        │
              │ Master key   │
              └──────┬───────┘
                     │
              metadata / выбранные данные
                     │
                     ↓
                React / WebView
```

React должен получать только то, что необходимо для отображения интерфейса.

Например:

```text
React:
- title
- username
- url
- tags
- выбранные дополнительные поля

Rust:
- открытая Database
- master password
- password каждой записи
- операции clipboard
- запись KDBX
```

При обычном `Copy password` пароль вообще не должен проходить через JavaScript.

Пароль попадает в frontend только если пользователь явно нажал `Показать пароль`.

---

# 3. Используемый стек

## Frontend

```text
React
TypeScript
Vite
Lucide React
CSS
```

## Desktop shell

```text
Tauri 2
```

## Backend

```text
Rust
```

## KDBX

Используется Rust crate:

```text
keepass 0.13.x
```

Для записи включён feature:

```toml
features = ["save_kdbx4"]
```

Важно:

> KDBX4 writer у `keepass-rs` считается experimental.

Поэтому запись базы реализуется максимально осторожно.

---

# 4. Почему KDBX

Мы не хотим делать:

```text
наш proprietary vault format
        ↓
приложение перестало развиваться
        ↓
пароли сложно достать
```

Вместо этого:

```text
passwords.kdbx
   ├── Vault
   ├── KeePassXC
   ├── KeePass
   └── другие KDBX-клиенты
```

Даже если Vault исчезнет, база останется стандартной KeePass-базой.

---

# 5. Текущая структура проекта

Примерно:

```text
vault-app/
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ styles.css
│  ├─ types.ts
│  ├─ shortcuts.ts
│  │
│  └─ components/
│     ├─ EntryEditor.tsx
│     ├─ SettingsModal.tsx
│     └─ CreateVaultModal.tsx
│
├─ src-tauri/
│  ├─ src/
│  │  ├─ lib.rs
│  │  └─ main.rs
│  │
│  ├─ capabilities/
│  │  └─ default.json
│  │
│  ├─ icons/
│  ├─ Cargo.toml
│  ├─ build.rs
│  └─ tauri.conf.json
│
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ README.md
```

---

# 6. История версий

## v0.1.0 — первый рабочий MVP

Сделано:

- Tauri 2 + React + TypeScript + Rust;
- выбор `.kdbx` через системный file dialog;
- ввод master password;
- открытие существующей KeePass базы;
- чтение записей;
- трёхпанельный UI;
- поиск;
- показать/скрыть пароль;
- копирование логина / пароля / URL;
- ручная блокировка;
- базовый современный интерфейс.

### Недостаток v0.1

После открытия базы все записи, включая пароли, отправлялись в React.

Это было признано плохой архитектурой для реального password manager.

---

# 7. v0.2.0 — security refactor

Основное изменение:

```text
KDBX
 ↓
Rust state
 ↓
React получает metadata
```

Добавлено:

- открытая база хранится на Rust-стороне;
- password конкретной записи запрашивается отдельно;
- notes загружаются только для выбранной записи;
- обычное копирование пароля выполняется Rust-кодом;
- frontend больше не получает password при обычном Copy;
- `zeroize::Zeroizing` используется для чувствительных строк;
- при `Lock` Rust state очищается;
- clipboard очищается при блокировке;
- clipboard очищается через 30 секунд.

---

# 8. Clipboard security

Первая версия cleanup держала plaintext ещё 30 секунд в отдельном Rust thread.

Это было улучшено.

Текущая идея:

```text
password
   ↓
Windows Clipboard
   ↓
SHA-256(password)
   ↓
plaintext temporary value уничтожается
```

Через 30 секунд:

```text
clipboard contents
   ↓
SHA-256
   ↓
сравнение
```

Если хеш совпадает:

```text
clipboard.clear()
```

Если пользователь за это время скопировал что-то другое:

```text
ничего не делать
```

Таким образом Vault не должен уничтожить чужое новое содержимое clipboard.

---

# 9. v0.3.0 — hardening + keyboard + editing

Добавлено большое количество security-механизмов.

## CSP

Release-версия должна быть максимально offline.

Используется строгий Content Security Policy.

Основная идея:

```text
default-src 'self'
object-src 'none'
frame-src 'none'
base-uri 'none'
form-action 'none'
```

Не добавлять внешние CDN, remote scripts, remote styles или произвольный network access без очень веской причины.

Dev CSP может разрешать localhost Vite server.

---

## Tauri capabilities

Frontend должен иметь минимальные permissions.

Особенно:

- React не должен иметь прямой clipboard access;
- clipboard вызывается через наши Rust commands;
- `set_content_protected()` вызывается Rust-кодом;
- не давать frontend ненужные filesystem/window/system permissions.

Включён:

```json
"removeUnusedCommands": true
```

Поэтому при сборке Tauri может выводить сообщения:

```text
Removed unused commands ...
```

Это нормально и желательно.

---

# 10. Защита окна

По умолчанию используется:

```text
set_content_protected(true)
```

Цель:

- ограничить штатный screen capture содержимого Vault;
- усложнить случайную демонстрацию паролей через приложения захвата экрана.

Это НЕ абсолютная защита от:

- malware;
- Administrator/SYSTEM;
- специальных capture mechanisms;
- физической камеры.

---

# 11. Auto-lock

Добавлена автоматическая блокировка.

Настраиваемые интервалы:

```text
1 мин
5 мин
10 мин
15 мин
30 мин
60 мин
```

По умолчанию:

```text
5 минут
```

Frontend сообщает Rust о пользовательской активности.

Rust хранит:

```text
last_activity: Instant
```

Фоновый Rust thread периодически проверяет timeout.

При превышении:

```text
session = None
clipboard.clear()
emit("vault-locked")
```

Frontend после события очищает локальное состояние.

---

# 12. Win+L / secure desktop

Отдельно реализована проверка Windows secure desktop.

Цель:

```text
Win+L
 ↓
Windows уходит с обычного input desktop
 ↓
Vault замечает это
 ↓
Vault блокируется
```

Также есть более строгая настройка:

```text
Block on blur
```

Если включена, Vault блокируется даже при обычном `Alt+Tab`.

По умолчанию:

```text
lockOnBlur = false
lockOnSecureDesktop = true
```

---

# 13. Показ пароля

При нажатии:

```text
👁 Show password
```

password должен попасть в frontend, потому что иначе WebView физически не сможет его показать.

Но делается это кратковременно.

По умолчанию:

```text
10 секунд
```

После таймера:

```text
showPassword = false
revealedPassword = ""
```

Также пароль скрывается при смене выбранной записи.

---

# 14. Keyboard-first UX

Одна из целей проекта — сделать Vault удобным для работы почти без мыши.

Текущие default hotkeys:

```text
Ctrl+C       Copy password
Ctrl+B       Copy username
Ctrl+U       Copy URL

Ctrl+F       Search
Ctrl+N       New entry
Ctrl+E       Edit entry
Ctrl+P       Reveal / hide password

Ctrl+L       Lock Vault
Ctrl+,       Settings

Arrow Up     Previous entry
Arrow Down   Next entry
Esc          Hide revealed password

Tab          standard focus navigation
Shift+Tab    reverse focus navigation
```

Важно:

Если focus находится внутри:

```text
input
textarea
select
contenteditable
```

глобальные Vault hotkeys не должны перехватываться.

Например:

```text
Ctrl+C
```

в textarea должен остаться обычным Copy.

---

# 15. Настраиваемые hotkeys

В Settings пользователь может менять сочетания.

Механика:

- нажать на shortcut;
- нажать новое сочетание;
- `Delete` / `Backspace` — отключить;
- `Esc` — отменить ввод;
- одинаковые shortcut для разных actions запрещены.

Настройки сохраняются локально.

---

# 16. UI и scroll behaviour

Изначально левая и правая панели прокручивались даже когда содержимое помещалось.

Это было исправлено.

Целевая схема:

```text
Sidebar
→ не прокручивается

Entry list
→ scroll только если список реально длинный

Detail panel
→ scroll только если содержимое выбранной записи не помещается
```

Корневые элементы:

```css
html,
body,
#root {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

Внутри используются конкретные scroll containers.

---

# 17. Поля записи

Текущая модель записи включает:

```text
Title
Username
Password
URL
Email
Phone
Description
Notes
Tags
```

В KDBX они хранятся как стандартные/custom string fields:

```text
Title
UserName
Password
URL
Email
Phone
Description
Notes
```

Tags используются через `entry.tags`.

---

# 18. Настраиваемые отображаемые поля

В Settings есть:

```text
Поля записи
```

Можно включать / выключать:

```text
Username
Password
URL
Email
Phone
Tags
Description
Notes
```

Title отображается всегда.

Цель — дать пользователю возможность сделать правую панель минималистичной.

Пример:

```text
ON:
- Login
- Password
- URL

OFF:
- Email
- Phone
- Tags
- Description
- Notes
```

Настройки сохраняются локально.

---

# 19. Password generator

В Entry Editor есть генератор.

Текущая длина:

```text
16–64 символа
```

Используется:

```text
crypto.getRandomValues()
```

Не использовать `Math.random()` для генерации паролей.

Алфавит примерно включает:

```text
A-Z
a-z
2-9
special chars
```

При генерации применяется rejection sampling, чтобы не создавать modulo bias.

---

## Важное UX-правило генератора

После:

```text
Generate
```

пароль **НЕ должен автоматически показываться**.

Правильное поведение:

```text
Generate
 ↓
••••••••••••••••••••••
```

Если пользователь хочет посмотреть:

```text
👁
```

---

# 20. Добавление и редактирование записей

Есть:

```text
+ New entry
Edit
```

Редактирование existing entry сознательно не загружает текущий password в форму.

По умолчанию:

```text
☐ Change password
```

Если checkbox выключен:

```text
current password never enters editor frontend
```

Если включён:

```text
user enters/generates a new password
```

---

# 21. Experimental KDBX writing

Это одна из самых важных частей проекта.

`keepass-rs` умеет писать KDBX4, но writer помечен как experimental.

Поэтому запись существующей базы **выключена по умолчанию**.

В Settings есть:

```text
Allow experimental KDBX4 writing
```

До включения Add/Edit не должны молча модифицировать базу.

---

# 22. Safe KDBX save pipeline

При каждом изменении существующей базы используется схема:

```text
original.kdbx
      │
      ├──────→ vault-backups/
      │          original.kdbx.TIMESTAMP.bak
      │
      ↓
temporary file
      ↓
Database::save()
      ↓
sync_all()
      ↓
reopen temp file using same master password
      ↓
verification OK?
      │
      ├── NO
      │    ↓
      │  delete temp
      │  keep original untouched
      │
      └── YES
           ↓
     atomic replace
```

На Windows используется:

```text
ReplaceFileW
```

Идея:

> Исходный KDBX не заменяется, пока новая версия не записана полностью и не прошла повторное открытие.

---

# 23. Ошибка Unsupported database version

Во время тестирования при Add Entry возникло:

```text
Ошибка записи KDBX: Unsupported database version
```

Причина:

`keepass-rs` при `Database::save()` ориентируется на:

```rust
database.config.version
```

Writer поддерживает KDBX 4.1.

Поэтому для KDBX4 перед записью нормализуется **in-memory writer target**:

```rust
database.config.version = DatabaseVersion::KDB4(1);
```

Это делается:

- после открытия поддерживаемой KDBX4 базы;
- дополнительно перед сохранением.

Это не должно модифицировать исходный файл само по себе.

---

# 24. Создание новой собственной базы

Начиная с v0.3.2 Vault умеет создавать новую базу.

На unlock screen:

```text
Create new database
```

Пользователь:

1. выбирает путь;
2. задаёт master password;
3. подтверждает master password;
4. подтверждает experimental writer warning.

Создание:

```text
Database::new()
 ↓
database.config.version = KDB4(1)
 ↓
write temp KDBX
 ↓
sync_all
 ↓
reopen with master password
 ↓
verification
 ↓
move to chosen destination
 ↓
open inside Vault
```

Если файл уже существует:

```text
creation must fail
```

Vault не должен молча перезаписывать существующий `.kdbx`.

---

# 25. Last used database

После успешного Open/Create сохраняется путь последней базы.

Пример:

```text
D:\Passwords\main.kdbx
```

Хранится только путь.

Master password НЕ хранится.

При следующем запуске:

```text
main.kdbx
D:\Passwords\main.kdbx · last database

Master password:
[____________]

[Open Vault]
```

То есть пользователь вводит только master password.

В будущем Windows Hello должен позволить ещё больше сократить этот flow.

---

# 26. Пустая база

Раньше использовалось:

```ts
entries.length === 0
```

как признак закрытого Vault.

Это неправильно для новой пустой базы.

Теперь должен использоваться отдельный state:

```ts
unlocked: boolean
```

Поэтому:

```text
unlocked = true
entries.length = 0
```

является нормальным состоянием.

UI:

```text
Database is empty
Create your first entry

[ + New entry ]
```

---

# 27. Master password

После unlock master password хранится на Rust side, потому что он пока нужен для последующих KDBX save operations.

Используется:

```rust
Zeroizing<String>
```

Master password не должен:

- записываться в logs;
- сохраняться в localStorage;
- сохраняться в config;
- отправляться в frontend после unlock;
- попадать в error messages.

---

# 28. Sensitive logging rules

Никогда не логировать:

```text
master password
password
notes
full decrypted entry
full IPC payload containing secrets
clipboard content
```

Даже в debug mode.

Разрешены сообщения уровня:

```text
database opened
entry saved
backup created
database verification failed
```

Но без секретного содержимого.

---

# 29. Release hardening

В release profile используются настройки вида:

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
strip = true
opt-level = "s"
```

DevTools отключены.

Release CSP должен быть жёстче dev CSP.

---

# 30. CSS architecture

Custom CSS ещё не реализован, но он запланирован.

Основные визуальные параметры уже вынесены в CSS variables:

```css
--accent
--accent-hover
--surface
--surface-soft
--surface-selected
--border
--text
--muted
--sidebar
--danger
```

Это сделано специально для будущего:

```text
Settings
└── Appearance
    ├── accent
    ├── radius
    ├── density
    ├── sidebar width
    └── Custom CSS
```

---

# 31. Custom CSS — требования на будущее

Пользователь хочет возможность использовать собственный CSS.

Желаемая идея:

```text
Settings
→ Appearance
→ Custom CSS
```

Но нужно учитывать безопасность.

Custom CSS:

- только локальный;
- без remote import;
- CSP не должен разрешать внешние stylesheets;
- желательно фильтровать / запрещать `@import url(http...)`;
- не давать CSS каким-либо образом расширять системные permissions.

---

# 32. Windows Hello — план

Windows Hello пока не реализован.

Не делать примитивный вариант:

```text
store plaintext master password in Credential Manager
```

Нужна нормальная архитектура.

Цель примерно такая:

```text
master password
 ↓
one-time setup
 ↓
encrypted local unlock secret
 ↓
protected using Windows Hello / Windows protected key
```

При следующем запуске:

```text
last KDBX
 ↓
Windows Hello
 ↓
unlock protected local secret
 ↓
open KDBX
```

Нужно отдельно продумать threat model.

---

# 33. TOTP — план

Добавить поддержку:

```text
otpauth://...
```

Нужно:

- импортировать TOTP secret;
- показывать текущий code;
- countdown;
- Copy TOTP hotkey;
- желательно не вычислять всё во frontend, если можно держать secret в Rust.

---

# 34. Browser extension — план

В будущем:

```text
Browser extension
      ↓
Native Messaging
      ↓
Vault desktop app
      ↓
Rust Database
```

Browser extension не должен иметь прямого доступа к KDBX.

Desktop app должен:

- подтверждать origin/domain;
- отдавать только подходящие credentials;
- иметь allow/deny UI;
- блокироваться вместе с основным Vault.

---

# 35. Sync — план

В перспективе база должна синхронизироваться между устройствами.

Возможные варианты:

```text
Syncthing
WebDAV
Nextcloud
VPS
```

Важно:

синхронизируется **зашифрованный `.kdbx`**, а не расшифрованные passwords.

Нужно учитывать:

- concurrent writes;
- conflict files;
- history/backup;
- atomic save;
- timestamp / hash checks.

---

# 36. UX-направление

Визуальная цель проекта:

> современный, чистый, лёгкий password manager без визуального наследия классического KeePass.

Текущая композиция:

```text
┌──────────────┬─────────────────────┬────────────────────────────┐
│ Sidebar      │ Entry list          │ Entry detail               │
│              │                     │                            │
│ All entries  │ GitHub              │ GitHub                     │
│ Settings     │ Google              │ Login                      │
│ Lock         │ VPS                 │ Password                   │
│              │ ...                 │ URL / Email / etc.         │
└──────────────┴─────────────────────┴────────────────────────────┘
```

Не перегружать UI.

---

# 37. Клавиатура должна быть first-class

При добавлении новых функций сразу думать о hotkey / keyboard flow.

Например в будущем:

```text
Ctrl+Shift+C   copy TOTP
Ctrl+K         command palette
Ctrl+G         password generator
Ctrl+1         All
Ctrl+2         Favorites
Ctrl+3         Servers
Ctrl+Enter     Save editor
Delete         Delete entry
F2             Rename/edit
```

Но новые default shortcuts нельзя добавлять без проверки конфликтов.

Все hotkeys желательно пропускать через существующий settings mechanism.

---

# 38. Возможный Command Palette

Хорошее направление:

```text
Ctrl+K
```

Открывает:

```text
> copy password
> copy username
> new entry
> edit entry
> lock vault
> generate password
> settings
> switch database
```

Это хорошо соответствует keyboard-first цели.

---

# 39. Поля записи — дальнейшее развитие

Кроме уже существующих полей полезно добавить configurable custom fields.

Например:

```text
SSH host
SSH user
Port
API token
Recovery codes
PIN
Card number
Expiry
CVV
Server IP
Database URL
```

Но лучше не hardcode десятки полей.

Правильнее:

```text
standard fields
+
custom key/value fields
```

KDBX это позволяет.

---

# 40. Категории и группы

Нужно добавить нормальную работу с KDBX groups.

Например:

```text
All
Favorites
Work
Personal
Servers
Cards
Secure Notes
```

Важно:

лучше использовать реальные KDBX groups/tags, а не создавать отдельную несовместимую database model.

---

# 41. Favorites

Можно хранить custom field или tag.

Например:

```text
VaultFavorite = true
```

Но нужно сначала проверить, как это будет выглядеть при открытии базы в KeePassXC.

Предпочтение:

> не ломать interoperability.

---

# 42. Favicon

Планируется отображение favicon сайтов.

Но security/privacy consideration:

Vault не должен автоматически отправлять список всех domains на внешний favicon service.

Предпочтительные варианты:

1. локальный cache;
2. запрос favicon напрямую с сайта только после explicit opt-in;
3. возможность полностью отключить network favicon.

По умолчанию приложение должно оставаться offline-friendly.

---

# 43. Network philosophy

По умолчанию Vault должен иметь:

```text
NO network access
```

Любые будущие сетевые функции:

```text
sync
favicon
breach check
updates
```

должны быть:

- явно отделены;
- желательно opt-in;
- иметь минимальные permissions;
- не отправлять secret data.

---

# 44. Password health

Планируется локальный password health.

Можно проверять:

```text
weak passwords
duplicate passwords
old passwords
missing TOTP
missing URL
```

Это можно делать локально в Rust.

Не отправлять passwords во внешние сервисы.

Для Have I Been Pwned в будущем использовать k-anonymity, если вообще добавлять.

---

# 45. Threat model

Vault должен хорошо защищать от:

- украденного `.kdbx`;
- случайного screen sharing;
- случайно оставленного открытого приложения;
- clipboard leakage;
- XSS / чрезмерных WebView permissions;
- повреждения файла при записи;
- неправильного save cycle;
- потери базы из-за ошибки приложения.

Vault не может гарантированно защитить от:

```text
malware with Administrator/SYSTEM
process memory dumping
kernel compromise
hardware keylogger
physical camera
compromised Windows session
```

Если attacker уже полностью контролирует ОС, считать password manager защищённым нельзя.

---

# 46. Важное правило: не писать собственную криптографию

НЕ делать:

```text
custom encryption scheme
custom vault cipher
custom KDF
homebrew AES wrapper
```

Использовать:

```text
KDBX
AES / ChaCha from KDBX ecosystem
Argon2
tested cryptographic libraries
OS crypto APIs
```

UI и UX можно писать своими.

Криптографический формат — нет.

---

# 47. Что нужно проверять после любого изменения writer

После изменений KDBX save logic проводить минимум такой manual test:

```text
1. создать копию test.kdbx
2. открыть в Vault
3. создать запись
4. сохранить
5. закрыть Vault
6. снова открыть через Vault
7. проверить запись
8. открыть тот же файл в KeePassXC
9. проверить запись
10. изменить запись в Vault
11. открыть KeePassXC
12. проверить history / custom fields
13. убедиться, что backup существует
```

Никогда первым тестом не использовать единственную копию основной базы.

---

# 48. Backups

Backups создаются рядом с базой:

```text
<database folder>/
├─ passwords.kdbx
└─ vault-backups/
   ├─ passwords.kdbx.XXXXXXXX.bak
   └─ ...
```

В будущем нужно добавить:

- retention policy;
- max number;
- age limit;
- Restore backup UI;
- open backup read-only;
- возможно configurable backup path.

---

# 49. Создание новой базы — future improvements

Текущая новая база создаётся с KDBX4.1 writer.

В будущем желательно добавить настройки:

```text
KDF:
Argon2id

memory:
xxx MB

iterations:
automatic calibration

cipher:
AES-256 / ChaCha20
```

Но не надо придумывать произвольные unsafe defaults.

Можно ориентироваться на современные KeePassXC defaults.

---

# 50. Last database — future improvement

Сейчас хранится только путь.

В будущем можно хранить список:

```text
Recent databases
```

Например:

```text
main.kdbx
work.kdbx
servers.kdbx
```

Но master password для них не сохранять без Windows Hello secure storage layer.

---

# 51. Текущее поведение startup

Желаемый startup flow:

```text
Vault starts
   ↓
last database path exists?
   │
   ├─ YES → preselect it
   │         focus master password
   │
   └─ NO  → offer Open / Create
```

Не открывать file picker автоматически.

---

# 52. Текущий visual direction

Светлый нейтральный UI с фиолетовым accent.

Тема не должна быть слишком тёмной.

Основной стиль:

```text
rounded panels
clean borders
low-contrast surfaces
minimal shadows
compact rows
keyboard hints
```

Не превращать UI в тяжёлый enterprise dashboard.

---

# 53. Что сейчас НЕ делать без обсуждения

Не добавлять внезапно:

- облачный backend;
- telemetry;
- analytics;
- crash reporting, отправляющий memory/state;
- remote scripts;
- Electron;
- proprietary database format;
- сохранение master password;
- automatic network requests;
- десятки dependencies без необходимости.

---

# 54. Coding style

Предпочтение пользователя:

- условия `if` и заголовки `for` не разбивать на несколько строк без необходимости;
- компактное форматирование кода;
- не добавлять лишние комментарии в очевидные места;
- комментарии нужны там, где есть security reason / non-obvious design decision.

---

# 55. Build / development

На Windows используются:

```text
Node.js
Rust
Visual Studio Build Tools 2022
Desktop development with C++
MSVC v143
Windows SDK
WebView2
```

Dev:

```powershell
npm install
npm run tauri dev
```

Release в будущем:

```powershell
npm run tauri build
```

Нужно будет отдельно настроить:

- `.exe` / MSI;
- application icon;
- signing;
- update mechanism.

---

# 56. Текущий статус проекта

На текущем этапе реализовано:

```text
[✓] Open existing KDBX
[✓] Create new KDBX
[✓] Remember last database path
[✓] Search
[✓] Metadata stays in frontend
[✓] Password stays Rust-side unless explicitly revealed
[✓] Rust clipboard copy
[✓] Clipboard auto-clear
[✓] Auto-hide password
[✓] Auto-lock
[✓] Win+L / secure desktop lock
[✓] Optional lock-on-blur
[✓] Screen content protection
[✓] Strict CSP
[✓] Minimal Tauri permissions
[✓] Customizable hotkeys
[✓] Arrow-key entry navigation
[✓] Configurable visible fields
[✓] Password generator
[✓] Add entry
[✓] Edit entry
[✓] Backup before write
[✓] Temp write + verification
[✓] Atomic replace on Windows
[ ] Delete entry
[ ] Restore backup
[ ] KDBX groups
[ ] Favorites
[ ] Custom fields
[ ] TOTP
[ ] Windows Hello
[ ] Browser extension
[ ] Custom CSS editor
[ ] Theme UI
[ ] Sync
[ ] Installer
[ ] Signing
[ ] Tests / fuzzing / audit
```

---

# 57. Ближайший roadmap

Предпочтительный порядок:

## Phase 1 — стабилизировать KDBX writer

```text
Add/Edit testing
Delete
Backup restore
Save regression tests
KeePassXC compatibility tests
```

## Phase 2 — UX

```text
Groups
Favorites
Custom fields
Command palette
better keyboard navigation
field ordering
field visibility
```

## Phase 3 — Security

```text
Windows Hello
secure unlock key
memory handling review
sensitive-string audit
lock on sleep/hibernate
```

## Phase 4 — password features

```text
TOTP
password history
password health
duplicate detection
recovery codes
```

## Phase 5 — integration

```text
Browser extension
Native Messaging
autofill
```

## Phase 6 — customization

```text
Themes
Custom CSS
density
accent
layout settings
```

## Phase 7 — sync

```text
VPS / WebDAV / Syncthing
conflict detection
revision tracking
```

---

# 58. Основная продуктовая цель

Vault не должен стать просто «ещё одним KeePass-клоном».

Цель:

```text
надёжность KDBX
+
современный UI
+
keyboard-first interaction
+
гибкая кастомизация
+
Windows integration
+
локальность
```

Приоритеты:

```text
1. безопасность данных
2. совместимость KDBX
3. отсутствие vendor lock-in
4. удобство
5. внешний вид
6. расширяемость
```

---

# 59. Главный принцип для дальнейшего Codex/AI-разработчика

Перед изменением задавать себе три вопроса:

### 1. Нужно ли секрету попадать во frontend?

Если нет — оставлять в Rust.

### 2. Может ли изменение повредить KDBX?

Если да:

```text
backup
→ temp write
→ verification
→ atomic replace
```

### 3. Не ломает ли это совместимость с KeePassXC?

Если ломает — сначала обсудить альтернативу.

---

# 60. Краткая формулировка проекта для Codex

> Мы делаем локальный Windows password manager на Tauri 2 + React + Rust, который использует стандартные KeePass KDBX базы. UI должен быть современным, keyboard-first и кастомизируемым. Криптографию и формат базы не изобретаем. Секреты по возможности остаются в Rust, frontend получает минимум данных. Любая запись KDBX должна быть защищена backup + temp write + reopen verification + atomic replace. Приложение должно оставаться совместимым с KeePassXC и не иметь обязательного network backend. В будущем планируются Windows Hello, TOTP, browser extension, custom CSS и синхронизация зашифрованной KDBX базы.
