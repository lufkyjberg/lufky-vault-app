# Сборка Vault

Vault собирается локально из исходников. `package-lock.json` и `src-tauri/Cargo.lock`
должны храниться в Git: они фиксируют проверенные версии зависимостей и делают сборки
воспроизводимыми.

## Проверка после клонирования

```bash
npm ci
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Используй `npm ci` для чистой установки. `npm install` нужен при намеренном обновлении
зависимостей; после него проверяй изменения `package-lock.json`.

## Windows 10/11

### Зависимости

- Node.js 20 или 22 LTS;
- Rust stable через rustup;
- Microsoft Edge WebView2 Runtime;
- Visual Studio Build Tools 2022;
- workload `Desktop development with C++`;
- MSVC v143 и актуальный Windows SDK.

### Development

```powershell
npm ci
npm run tauri dev
```

### Release и NSIS installer

```powershell
npm run tauri build
```

Результаты:

```text
src-tauri/target/release/vault-app.exe
src-tauri/target/release/bundle/nsis/Vault_<version>_x64-setup.exe
```

При первой сборке Tauri может загрузить NSIS. Неподписанный installer может вызвать
предупреждение Windows SmartScreen. Для распространения нужна подпись кода; отключать
SmartScreen на пользовательских компьютерах не следует.

## Debian / Ubuntu

### Системные зависимости

```bash
sudo apt update
sudo apt install -y build-essential curl wget file libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libwebkit2gtk-4.1-dev patchelf nodejs npm
```

Установка Rust stable:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

Если системная версия Node.js слишком старая для Vite, установи Node.js 20/22 LTS
подходящим для дистрибутива способом и проверь `node --version`.

### Сборка

```bash
npm ci
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build
```

Результаты:

```text
src-tauri/target/release/vault-app
src-tauri/target/release/bundle/deb/*.deb
src-tauri/target/release/bundle/appimage/*.AppImage
```

## Arch Linux

### Системные зависимости

```bash
sudo pacman -S --needed base-devel curl wget file openssl gtk3 \
  webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf nodejs npm rustup
rustup default stable
```

### Сборка

```bash
npm ci
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run tauri build
```

На Arch запускай `src-tauri/target/release/vault-app` или созданный AppImage. `.deb`
предназначен для Debian-подобных систем.

## Только frontend

```bash
npm run dev
npm run build
```

Эти команды проверяют React/TypeScript, но не Rust backend. Для password manager всегда
дополнительно запускай `cargo test` и полную Tauri-сборку.

## Чистая пересборка

При необходимости можно удалить только локальные generated/build-каталоги:

```text
node_modules/
dist/
src-tauri/target/
src-tauri/gen/
```

Не удаляй `package-lock.json` и `src-tauri/Cargo.lock` при обычной пересборке.

## Что не коммитить

- настоящие `.kdbx` и `.kdb`;
- `vault-backups/`;
- `.env` и credentials;
- `node_modules/`, `dist/`, `src-tauri/target/`;
- installers, `.deb`, AppImage и другие готовые бинарные артефакты.

Перед первым commit:

```bash
git status --short
git check-ignore -v node_modules dist src-tauri/target src-tauri/gen
```

Если build-файлы уже были добавлены в Git до появления ignore-правил, убери их только
из индекса, сохранив локальные копии:

```bash
git rm -r --cached node_modules dist src-tauri/target src-tauri/gen
git add .gitignore BUILDING.md
```

Очистка уже опубликованной Git-истории — отдельная разрушительная операция. Не запускай
её без резервной копии и согласования с другими участниками репозитория.
