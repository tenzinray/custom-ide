# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Screenshots and recordings

- Save all local screenshots, image previews, and screen recordings under this repository's `screenshots/` directory, never `logs/`, `/tmp`, or another artifact directory. Keep text logs and launch metadata in `logs/`.
- Capture CLI screenshots with `scripts/captureScreenshot.sh <playwright-session> <relative-filename.png> [screenshot options]`. It creates the output directory and automatically deletes files in `screenshots/` older than 24 hours before each capture. Use a unique Playwright session for each dev instance.
- Before taking screenshots or recordings through another API (such as `page.screenshot()` or `page.screencast`), run `scripts/captureScreenshot.sh --prune-only`, then write the media under `screenshots/`. This rule overrides alternate output locations in skill examples. Do not add a cleanup watcher or scheduled job.
- Keep screenshots and recordings out of Git. Inspect captures when possible; if the image tool cannot display one, say so rather than claiming visual verification.

## Installed Pide updates

Follow [the build, signing, update, and rollback instructions](build/darwin/pide-build.md#update-installed-pide). Replace only the app bundle; never replace or resync installed profiles, settings, extensions, or chats. Stop temporary dev apps and build watchers when finished.
