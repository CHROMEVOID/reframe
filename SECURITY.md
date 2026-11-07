# Security

## Reporting a problem
Please open a private security advisory on GitHub (Security → Report a vulnerability) rather than a public issue.

## How Reframe keeps you safe
- **No accounts, keys or tracking.** Reframe has no API keys, no analytics and no server of its own. Nothing about you is sent anywhere.
- **Your sign-ins stay on your PC.** Plex / Jellyfin / Emby tokens are encrypted with Windows (DPAPI via Electron `safeStorage`) and stored only in `%APPDATA%\Reframe`. They are never in this repository.
- **Locked-down windows.** Every window uses `contextIsolation`, `sandbox` and no Node integration; pages only reach the app through a small, checked bridge.
- **Tools come from official sources.** yt-dlp and FFmpeg are only downloaded when you ask, straight from their official release pages, over HTTPS.
- **Up-to-date engine.** Reframe runs on a supported Electron release with its security fixes. This matters for the Capture browser, which opens real websites.
- **Websites can't reach your computer.** The Capture browser shows sites in a separate, sandboxed view with no access to Reframe's own bridge; pop-ups and cross-site jumps ask first.
- **Your files are never changed.** Converting writes a new "converted" folder; originals are only read.

## For contributors
Never commit `.env` files, tokens, cookies or anything from `%APPDATA%\Reframe`. The `.gitignore` already blocks the common ones.
