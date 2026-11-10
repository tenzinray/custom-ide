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

A migration from the current temporary dev window is already queued outside the repository. Fully quit the dev app before the next normal development launch; the existing migration refuses to copy a live source and preserves extensions, settings, workspace state, history, backups and shared storage. Do not delete the queued source. Subsequent permanent launches do not resynchronize or reset the profile.

Before opening Pide for the first time, arrange a separate one-time offline copy from the initialized permanent dev profile to the installed paths above. Back up the source first, refuse to overwrite an existing installed profile, and exclude runtime locks/caches using the existing profile migration exclusions in `scripts/code-oss-launcher/lib/profileCopy.ts`. Do not copy a live SQLite profile. Migration to the installed app is not automated yet. Authentication may need signing in again because app identity and OS-protected secret storage change.

## Install/update

The signed app is installed at `/Applications/Pide.app`. Its workbench and Pi Conversation surface were smoke-tested with a disposable profile; the signed UI test used mock secret storage because normal first-launch Keychain approval requires the user. The packaged CLI also recognized all nine restored extensions copied into a disposable test extensions directory. The real installed profile has not been initialized or migrated yet.

Before the first normal launch, finish the offline profile copy described above. For subsequent builds, quit the installed app and replace only the closed `.app`; do not recopy the dev profile. Automatic update hosting is not configured.
