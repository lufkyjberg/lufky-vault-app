# Vault 0.3.2 — локальный KDBX password manager

Vault работает на Windows и Linux (Debian/Ubuntu и Arch). База остаётся стандартным
KDBX4-файлом и открывается в KeePassXC. Сетевой backend приложению не требуется.

Подробные зависимости, команды development/release-сборки и расположение артефактов
описаны в [BUILDING.md](BUILDING.md).

## Главное

Vault остаётся локальным Tauri-приложением. Расшифрованная база хранится в Rust state.

### Security pass

- строгий CSP;
- frontend не имеет clipboard permission;
- password copy выполняется Rust-кодом;
- через 30 секунд поток хранит только SHA-256 скопированного значения, а не plaintext;
- показанный пароль автоматически скрывается;
- master password хранится только в Rust после unlock и обёрнут в `Zeroizing<String>`;
- автоблокировка по таймеру;
- на Windows блокировка при `Win+L` / переходе на secure desktop включена по умолчанию;
- опциональная ещё более строгая блокировка при любой потере фокуса окна;
- очистка clipboard и Rust session при lock/close;
- `set_content_protected(true)` включён по умолчанию;
- DevTools выключены;
- внешние network resources запрещены CSP.

Ограничение: если нажать «показать пароль», конкретный пароль на несколько секунд должен попасть в WebView, иначе браузерный UI физически не сможет его отрисовать.

## Keyboard

По умолчанию:

| Shortcut | Action |
|---|---|
| Ctrl+C | Copy password |
| Ctrl+B | Copy username |
| Ctrl+U | Copy URL |
| Ctrl+F | Search |
| Ctrl+N | New entry |
| Ctrl+E | Edit entry |
| Ctrl+L | Lock |
| Ctrl+, | Settings |
| Ctrl+P | Reveal/hide password |
| Arrow Up/Down | Previous/next entry |
| Esc | Hide password |

Хоткеи можно менять в Settings. В input/textarea системные Ctrl+C и остальные сочетания не перехватываются.

## KDBX write

Редактирование разрешено только для KDBX4 и выключено по умолчанию. В Settings нужно один раз явно включить **«Разрешить экспериментальную запись KDBX4»**.

Перед каждой записью:

1. Исходный KDBX копируется в `vault-backups/`.
2. Новая база пишется во временный файл.
3. Временный KDBX повторно открывается тем же master password.
4. Только после успешной проверки исходный файл атомарно заменяется через Windows
   `ReplaceFileW` или Unix `rename` с синхронизацией каталога.

`keepass-rs` помечает KDBX4 writer как experimental. Поэтому пока используй эту функцию сначала на копии своей основной базы и не удаляй backups.

## Поля записи

- Title
- Username
- Password
- URL
- Email
- Phone
- Description
- Notes
- Tags

При редактировании существующей записи пароль не загружается в форму. Он меняется только если включить «Изменить пароль».

## Проверки

Regression-тесты создают настоящие временные KDBX4-файлы и проверяют создание,
повторное открытие, отказ от перезаписи, backup и сохранение записи:

```text
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run build
```

Тестовые базы создаются во временной системной папке и удаляются автоматически.

## Windows

Для разработки нужны Node.js, Rust, WebView2 и Visual Studio Build Tools с workload
`Desktop development with C++`.

```powershell
npm install
npm run tauri dev
npm run tauri build
```

Release-сборка создаёт executable и NSIS installer в `src-tauri/target/release/`.

## Debian / Ubuntu

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libwebkit2gtk-4.1-dev patchelf

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm install
npm run tauri dev
npm run tauri build
```

Сборка создаёт `.deb` и AppImage в `src-tauri/target/release/bundle/`.

## Arch Linux

```bash
sudo pacman -S --needed base-devel curl wget file openssl gtk3 \
  webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf nodejs npm rustup

rustup default stable
npm install
npm run tauri dev
npm run tauri build
```

На Arch используй AppImage из `src-tauri/target/release/bundle/appimage/` либо запускай
`src-tauri/target/release/vault-app` напрямую.

### Ограничения Linux

- системная блокировка по Win+L/secure desktop реализована только на Windows;
- защита окна от штатного screen capture реализована только на Windows;
- на Linux доступны автоблокировка и строгая блокировка при потере фокуса;
- безопасность clipboard зависит также от используемых X11/Wayland compositor и clipboard manager.

## Перед переносом основной базы

1. Сделай независимую копию KDBX вне папки `vault-backups`.
2. Несколько дней используй Vault на копии базы.
3. После Add/Edit закрой Vault и открой тот же файл в KeePassXC.
4. Не синхронизируй один KDBX одновременно с двух устройств во время записи.
5. Используй уникальный длинный master password и полное шифрование диска ОС.

## Custom CSS

Пока не включён. Основные цвета/поверхности уже вынесены в CSS variables в `src/styles.css`, поэтому сделать редактор custom CSS следующим этапом будет просто.


## 0.3.1 — KDBX writer version fix

Исправлена ошибка `Unsupported database version` при сохранении.

`Database::save()` в keepass-rs выбирает writer по `database.config.version`.
Для открытой KDBX4 базы Vault теперь нормализует только внутреннюю writer-конфигурацию
в `KDBX 4.1`, поскольку именно этот формат поддерживает экспериментальный writer библиотеки.

Исходный `.kdbx` по-прежнему не меняется до успешного завершения цепочки:
backup → temp write → reopen verification → atomic replace.


## 0.3.2

### Создание собственной базы

На экране разблокировки появилась кнопка `Создать новую базу`.

Vault:
1. предлагает выбрать имя и путь;
2. создаёт стандартную KDBX 4.1;
3. пишет её во временный файл;
4. повторно открывает мастер-паролем;
5. только после успешной проверки перемещает файл на выбранный путь;
6. сразу открывает новую базу в приложении.

Создание использует тот же экспериментальный writer `keepass-rs`, поэтому в окне есть отдельное подтверждение.

### Последняя база

После успешного открытия или создания путь сохраняется только локально в настройках WebView.
Мастер-пароль не сохраняется.

При следующем запуске последняя база уже выбрана, поэтому остаётся только ввести master password.

### Видимые поля

Settings → `Поля записи`:

- Логин
- Пароль
- URL
- Email
- Телефон
- Теги
- Описание
- Заметки

Название записи показывается всегда.

### Генератор паролей

`Сгенерировать` больше не раскрывает пароль. После генерации поле принудительно остаётся в masked-режиме.
