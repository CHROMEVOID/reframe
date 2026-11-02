# Third-party notices

Reframe's own code is MIT licensed (see `LICENSE`). It ships with, or downloads, the following software, each under its own licence.

| Component | Licence | How it's used | Source |
|---|---|---|---|
| **HandBrakeCLI** 1.11.2 | GPL-2.0 | Bundled, unmodified, run as a separate program for converting | https://github.com/HandBrake/HandBrake (licence and docs in `resources/handbrake/doc`) |
| **Electron** | MIT | App runtime | https://github.com/electron/electron |
| **Chromium** (inside Electron) | BSD-3-Clause and others | App runtime | `LICENSES.chromium.html` in the app folder |
| **@ghostery/adblocker-electron** | MPL-2.0 | Ad blocker in the Capture browser | https://github.com/ghostery/adblocker |
| **hls.js** | Apache-2.0 | Plays stream previews | https://github.com/video-dev/hls.js |
| **EasyList / uBlock Origin ad lists** (prebuilt by Ghostery) | GPL-3.0 / CC BY-SA 3.0 | Ad blocking rules (`assets/adblock-ads.bin`) | https://easylist.to, https://github.com/uBlockOrigin/uAssets |
| **Tranco list** | Free with attribution | Sorting sites by popularity (`assets/popular-sites.txt`) | Le Pochat et al., "Tranco", NDSS 2019 — https://tranco-list.eu |
| **yt-dlp** | Unlicense | Downloaded at the user's request from its official GitHub release, not bundled | https://github.com/yt-dlp/yt-dlp |
| **FFmpeg** (yt-dlp FFmpeg-Builds, GPL build) | GPL-3.0 | Downloaded at the user's request, not bundled | https://ffmpeg.org, https://github.com/yt-dlp/FFmpeg-Builds |

Site icons in `assets/sites` are the sites' own favicons, used only to label links to those sites. All trademarks belong to their owners; Reframe is not affiliated with any of them.

HandBrake is GPL-2.0 software by the HandBrake Team. Reframe calls it as an external program and does not change it; its full source is at the link above.
