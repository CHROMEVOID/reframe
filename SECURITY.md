# Security

## Reporting a problem
Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.

## How Reframe keeps you safe
- **No accounts, keys or tracking.** Reframe has no API keys, no analytics and no server of its own. Nothing about you is sent anywhere.
- **Your sign-ins stay on your PC.** Plex / Jellyfin / Emby tokens are encrypted with Windows (DPAPI via Electron `safeStorage`) and stored only in `%APPDATA%\Reframe`. They are never in this repository.
- **Locked-down windows.** Every window uses `contextIsolation`, `sandbox` and no Node integration; pages only reach the app through a small, checked bridge.
- **Tools come from official sources.** yt-dlp and FFmpeg are only downloaded when you ask, straight from their official release pages, over HTTPS.
- **Your files are never changed.** Converting writes a new "converted" folder; originals are only read.

## For contributors
Never commit `.env` files, tokens, cookies or anything from `%APPDATA%\Reframe`. The `.gitignore` already blocks the common ones.
