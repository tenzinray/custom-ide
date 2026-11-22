# Pide: personal macOS build

`product.json` is the canonical app identity. Keep its name, bundle ID, data folder names and URL protocol stable between releases. The original Pide artwork is saved unchanged at `resources/darwin/pide.png` (1254×1254). `resources/darwin/pide.icns` contains the macOS app icon sizes from 16×16 through 1024×1024, configured by the existing `darwinIcon` setting in `build/lib/electron.ts`.

## Build on Apple Silicon

From the checkout root, using the Node version in `.nvmrc` and the pinned pnpm version:

```sh
pnpm run gulp vscode-darwin-arm64
```

Output: `../VSCode-darwin-arm64/Pide.app`. This is a standalone application, not a development launcher. Packaging includes local built-in extensions, including `extensions/pi-chat`, through the existing extension build pipeline.

The Copilot extension is not bundled: desktop and remote packaging omit its separate extension compilation and SDK-shim steps. The existing `excludedExtensions` list in `build/lib/extensions.ts` already excludes it from normal built-in extension packaging. Default compile/watch commands no longer start its separate build, and `scripts/code.sh` disables its activation when running out of sources. Its source, explicit build commands and shared upstream editor/agent infrastructure remain intact. The product's `defaultChatAgent` metadata is retained because shared account services require it at startup; this metadata does not install the extension. Copilot's welcome-onboarding contribution is not registered, and its auto-update and trusted-auth entries are removed. Diagnostics: `logs/pide-build.log`.

## Sign with Developer ID

A paid Apple account alone is not sufficient: this Mac needs a **Developer ID Application** certificate and its private key in Keychain. An iPhone Distribution or Apple Distribution certificate is not a substitute. Create/import the certificate through Xcode's certificate manager or the Apple Developer portal; never commit its private key or credentials.

```sh
security find-identity -v -p codesigning
CODESIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
VSCODE_ARCH=arm64 node build/darwin/sign.ts .. --local
codesign --verify --deep --strict --verbose=2 ../VSCode-darwin-arm64/Pide.app
```

Local signing reuses the existing Electron signing implementation, hardened runtime settings and helper-specific entitlements. It uses the normal keychain search list; set `CODESIGN_KEYCHAIN` only when the identity lives in a specific keychain. CI signing continues to use its buildagent keychain. If Keychain asks whether `codesign` can access the signing key, use the login Keychain password and **Always Allow** to avoid a prompt for every nested signing operation. Notarization is not part of this local workflow.

After signing, do not edit the bundle, including its icon: that invalidates the signature. Rebuild and sign after artwork changes.

A first launch may also ask Keychain to allow **Pide** to access its encryption key, particularly after testing an unsigned build. This is separate from the `codesign` signing-key prompt. Approve the normal Pide app when ready; do not disable secure storage for normal use. Automated UI smoke checks may use `--use-mock-keychain` only in disposable test profiles.

## Separate dev and installed storage

- Normal development launches: `scripts/watch-and-launch.sh`, using the existing permanent profile at `~/.vscode-oss-dev-profile/` by default. Agent/testing launches remain intentionally isolated.
- Installed app user data: `~/Library/Application Support/Pide/`.
- Installed extensions: `~/.pide/extensions/`.
- Installed application-shared data: `~/.pide-shared/`.

The installed paths are derived by the application from `product.json`; they are not inside `Pide.app`. Replacing the app does not replace these directories. Do not run an uninstall/cleanup tool that also deletes app data.

The one-time dev-to-installed migration is complete, including all nine restored extensions. Both profiles now persist independently. **Do not repeat the profile copy when updating Pide.**

For any future intentional migration, fully quit both apps first, back up the destination, and use the existing migration exclusions in `scripts/code-oss-launcher/lib/profileCopy.ts` for runtime locks/caches. Regenerate cached theme data that references the source checkout. Never copy live SQLite databases. Authentication may need signing in again when app identity or OS-protected secret storage changes.

## Update installed Pide

Run from this checkout's root. This is a local build-and-replace workflow; automatic update hosting is not configured. Keep the existing app identity and Developer ID team unchanged.

### 1. Build, sign and verify while Pide stays open

Use the Node version in `.nvmrc` and the pinned pnpm version. Set `CODESIGN_IDENTITY` to the full Developer ID Application certificate name shown by `security find-identity -v -p codesigning`.

```sh
(
  set -e
  : "${CODESIGN_IDENTITY:?Set the Developer ID Application certificate name first}"
  pnpm run gulp vscode-darwin-arm64
  VSCODE_ARCH=arm64 node build/darwin/sign.ts .. --local
  codesign --verify --deep --strict --verbose=2 ../VSCode-darwin-arm64/Pide.app
)
```

Export `CODESIGN_IDENTITY` before running this block, using the example in [Sign with Developer ID](#sign-with-developer-id). If any step fails, stop: the installed app is still untouched. Do not modify the new bundle after signing.

### 2. Fully quit Pide, then replace only the app

Save your work and use **Cmd+Q**; closing the window is not enough. If the coding agent is running inside Pide, quitting disconnects that chat. Run the replacement from an external Terminal or another editor, not Pide's integrated terminal. Do not use the app's normal Restart action to coordinate a replacement.

This block refuses a running Pide, stages and verifies the new bundle before moving the old one, retains a rollback copy, and restores the old app if the final move fails. After a successful replacement, it automatically keeps only the two newest completed app backups; failed replacements never trigger pruning:

```sh
(
  set -e
  if pgrep -f '^/Applications/Pide[.]app/Contents/MacOS/Pide([[:space:]]|$)' >/dev/null; then
    echo 'Quit Pide completely before replacing it.' >&2
    exit 1
  fi
  test -d /Applications/Pide.app
  stage=$(mktemp -d /Applications/.pide-update.XXXXXX)
  ditto ../VSCode-darwin-arm64/Pide.app "$stage/Pide.app"
  codesign --verify --deep --strict "$stage/Pide.app"
  backups="$HOME/Library/Application Support/Pide App Backups"
  mkdir -p "$backups"
  backup=$(mktemp -d "$backups/update-XXXXXX")
  mv /Applications/Pide.app "$backup/Pide.app"
  if ! mv "$stage/Pide.app" /Applications/Pide.app; then
    mv "$backup/Pide.app" /Applications/Pide.app
    exit 1
  fi
  rmdir "$stage"
  printf 'Previous app saved at: %s/Pide.app\n' "$backup"
  if ! node build/darwin/pideAppBackups.ts "$backups"; then
    echo 'App updated, but backup cleanup failed. See the error above; older backups were not fully pruned.' >&2
  fi
  open /Applications/Pide.app
)
```

Backup retention is owned by `build/darwin/pideAppBackups.ts`: it orders completed `update-XXXXXX/Pide.app` backups by the backup directory's modification time, keeps the newest two, and removes older ones. It ignores unrelated files, incomplete backup folders, and symlinks. No background watcher or scheduled cleanup is needed; pruning runs as part of each successful installation.

Do not reopen Pide from the Dock while this block runs. If staging fails, the installed app remains unchanged; the hidden staging folder can be removed once you have confirmed its path. If macOS refuses writes to `/Applications`, resolve that permission issue before proceeding rather than changing signing or app-data permissions.

**Never delete, replace or resynchronize the installed user-data, extensions or shared-data directories during an update.** Only `/Applications/Pide.app` is replaced. The watcher is not required for the installed app.

### 3. Check the update

Confirm Pide opens, the intended change is present, Pi Conversation loads, and your settings, chats and extensions remain available. Approve a legitimate Keychain prompt if needed; do not disable secure storage. Keep the previous app until satisfied with the update.

### Roll back if needed

Fully quit Pide again. In an external terminal, move the failed `/Applications/Pide.app` aside and move the saved `Pide.app` from the printed backup folder back to `/Applications/Pide.app`, then reopen it. Do not merge app bundles with an in-place copy.

This rolls back application files only. Newer versions can migrate profile databases, so downgrading is not always compatible. Before a risky version jump, make a separate offline profile backup; do not automatically restore an older profile over newer user data.
