<p align="center">
  <img src="assets/logo.svg" width="120" alt="Reframe logo">
</p>

<h1 align="center">Reframe</h1>

<p align="center">
  <b><i>You reframe a picture. We reframe a video.</i></b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 10 and 11">
  <img src="https://img.shields.io/badge/powered%20by-HandBrake-E25C2B?style=for-the-badge" alt="Powered by HandBrake">
  <img src="https://img.shields.io/badge/license-MIT-a855f7?style=for-the-badge" alt="MIT license">
  <a href="https://www.tiktok.com/@chr0m3void"><img src="https://img.shields.io/badge/TikTok-@chr0m3void-ff4f73?style=for-the-badge&logo=tiktok&logoColor=white" alt="TikTok @chr0m3void"></a>
</p>

---

## So what is it?

I had a hard drive full of videos in every format you can think of, spread across folders inside folders inside folders. HandBrake is amazing, but feeding it one file at a time and then rebuilding the folder layout by hand got old fast. So I built Reframe.

You point it at a folder. It converts **every single video in there**, subfolders and all, and drops the results into a new `<folder> converted` copy laid out exactly like the original. Your original files don't get touched. Not renamed, not moved, nothing.

Then it kind of grew. It downloads videos now. It has a media library. It has its own little browser that sniffs out videos on a page. It got a bit out of hand honestly, but in a good way.

## What it can do

### 🎬 Convert whole folders at once
- Drag a folder in, pick a preset, hit go. That's the whole workflow.
- The folder structure gets mirrored 1:1, so `Holiday/2023/Beach/clip.mov` lands at `Holiday converted/2023/Beach/clip.mp4`.
- **Turbo mode** uses your graphics card (NVIDIA, AMD or Intel) and runs a few files side by side.
- Got your own HandBrake presets? Reframe picks them up.
- Converted half a folder last week? It skips what's done and carries on.

### ⬇️ Download videos
- Paste a link from YouTube, TikTok, Twitch, Reddit or [a frankly silly number of other sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md). Pick a quality, or just the audio, done.
- The **Capture browser** is a mini browser inside the app. Go to a page, press play, and Reframe lists every video it spots, with previews so you know which is which. Ads get kicked out of that list. Its buttons match the colour you pick in Settings.
- It has an ad blocker built in, and it asks before a site tries to bounce you somewhere else with a sneaky redirect.
- Right-click any picture or video on a page to save it there and then.

### 📚 Comics and galleries
- Open a chapter or gallery page, hit **Pictures**, and tell Reframe how the reader works:
  - **It scrolls** (down or sideways): Reframe scrolls the whole thing and grabs every page in reading order.
  - **I click Next**: click the reader's Next button, then its Back button (the site doesn't even notice those two clicks). Reframe then presses Next itself, page after page, while you watch. Hit Stop whenever you like.
- Everything gets packed into a `.cbz` any comic reader can open.
- Works with long vertical webtoons, one-page-at-a-time readers, two-page spreads and right-to-left manga.

### 🗂️ A media library that sorts itself
- Everything you convert or download lands in the library, sorted into categories based on the folder it came from.
- Thumbnails, search, favourites, grid or list view, plus a built-in player.
- If you want, it'll look through your PC for the videos you already have and sort those too. Nothing gets moved or uploaded.

### 🔗 Your own site lists
Drop a `.txt` file full of links into `Documents\Reframe Other Sites` and they show up in the Downloader. Put headings in the file and they turn into categories. It's a handy way to keep all your bookmarks in one spot.

### ☁️ Drives and media servers
Pull videos in from OneDrive, Google Drive and Dropbox folders, or sign in to **Plex**, **Jellyfin** or **Emby** and grab stuff from your own server.

### 🎨 Make it yours
Themes, accent colours, corner roundness, how much stuff moves, zoom. A quick setup walks you through the basics the first time you open it, and <kbd>Ctrl</kbd> + <kbd>K</kbd> pulls up a command palette so you can jump anywhere.

---

## Getting it

1. Go to **[Releases](../../releases)** and download `Reframe-x.x.x-win64.zip`.
2. Unzip it wherever you like: Desktop, Documents, a USB stick, anywhere.
3. Run `Reframe.exe`.

There's no installer. Want it gone? Delete the folder.

> [!NOTE]
> Windows might throw up a blue *"Windows protected your PC"* box the first time. That's only because the app isn't code-signed (those certificates are pricey). Hit **More info → Run anyway**.

### About the 18+ stuff
Reframe can list adult sites in the Downloader, but that section is **off by default** and asks you to confirm your age before it shows anything. If you'd rather it wasn't in the app at all, delete the file called `DELETE THIS FILE to remove all 18+ (NSFW) content.txt` sitting next to `Reframe.exe`. The section and its setting disappear completely. Put the file back if you change your mind.

---

## Building it yourself

You'll need Windows 10/11 and [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/CHROMEVOID/reframe.git
cd reframe
npm install
npm run fetch-handbrake
npm start
```

`fetch-handbrake` pulls the official HandBrakeCLI into `vendor/` (it's way too big to keep in git). When you're ready to package it up:

```bash
npm run pack
```

That spits out the finished app in `dist/Reframe-win32-x64`.

---

## Privacy

No accounts. No tracking. No analytics. No API keys tucked away in the code. Your settings live in `%APPDATA%\Reframe` on your own machine, and any server sign-ins are encrypted by Windows. yt-dlp and FFmpeg only get downloaded if you ask for them, straight from their official releases. The nitty-gritty is in [SECURITY.md](SECURITY.md).

## Please be decent

Download stuff you're allowed to download, and support the creators you like. Reframe is a tool. What you do with it is on you.

---

## Credits

Made by **chr0m3void**. If you like it, come say hi on [TikTok @chr0m3void](https://www.tiktok.com/@chr0m3void) 👋

Built on top of some seriously good open-source projects:
**[HandBrake](https://handbrake.fr)** · **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** · **[FFmpeg](https://ffmpeg.org)** · **[Electron](https://www.electronjs.org)** · **[Ghostery adblocker](https://github.com/ghostery/adblocker)** · **[hls.js](https://github.com/video-dev/hls.js)**

Their licences are all in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Reframe's own code is [MIT](LICENSE). Do what you like with it, just keep the credit.
