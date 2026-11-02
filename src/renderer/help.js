'use strict';
// Help page: what every part of Reframe does, in plain words.

const HELP = [
  ['convert', 'Convert a whole folder', [
    'Drop a folder on the window (or press Choose folder / Ctrl+O). Every video inside it — and inside every folder within it — is converted with HandBrake.',
    'You get a new folder next to the original, named “… converted”, with exactly the same layout. Photos, subtitles and other files are copied too.',
    'Your originals are only ever read — never changed, moved or deleted.',
    'Presets come from your HandBrake app, so any presets you made yourself are there too. Turbo uses your graphics card; Auto speed converts a few videos side by side when that helps.',
    'Run the same folder again later and only new videos are converted.',
  ]],
  ['download', 'Download a video', [
    'Paste a link and press Get video. You see the title, length and picture first, then choose quality (up to 4K) or audio only.',
    'Reframe tries, in order: yt-dlp (1,700+ supported sites) → the link as a direct file → reading the page and keeping only the video. The preview tells you which one will be used.',
    'Paste several links at once to queue them all. A copied link shows a “Use copied link” button.',
    'One-time setup: the video engine (yt-dlp, 23 MB). FFmpeg (91 MB) adds full HD/4K, merging and thumbnails for every format. Update both in Settings when sites change.',
    'Copy-protected streams (Netflix, Disney+ and similar) can’t be downloaded by anything legitimate.',
  ]],
  ['globe', 'Capture browser', [
    'A browser inside Reframe. Open it from the Downloader or by clicking any site in the list.',
    'Press play on a video: the Found button lights up and lists every video the page loaded (MP4, HLS, DASH). Press Download next to one.',
    '“Download this page” hands the page to the downloader instead.',
    'Sign in to sites here — downloads use the same sign-in.',
    'A site’s own Download button (MEGA, MediaFire, Google Drive…) works too: the file is saved to your downloads folder and shown in Activity.',
  ]],
  ['link', 'Your own sites (.txt files)', [
    'Put .txt files of http/https links in Documents › Reframe Other Sites, or press Import .txt. One link per line; “Name - link” gives it a name.',
    'Your links are added to the site list (they never replace the built-in sites). Click one to browse it, or press the download arrow on a video link.',
    '“Download all” queues every video link from your files at once.',
  ]],
  ['cloud', 'Drives & servers', [
    'Convert or add videos straight from any drive: your PC, USB sticks, network folders (NAS), OneDrive, Google Drive, Dropbox and iCloud folders.',
    'Share links from Google Drive, Dropbox, OneDrive, Box and Yandex Disk download directly from the Downloader.',
    'Plex: “Sign in with Plex” opens Plex’s own page — Reframe never sees your password. Jellyfin and Emby: sign in with your server address.',
    'Pick movies or whole shows; they download into Show › Season folders and can be converted automatically.',
  ]],
  ['library', 'Media library', [
    'Converted and downloaded videos are added automatically and sorted into categories that match their folders.',
    'Hover a video to preview it, click to play, star it to keep it in Favourites. Right-click for more: convert, rename, properties, add to a category.',
    'Drag videos onto a category in the side bar. Ctrl-click or Shift-click to select several; Ctrl+A selects all; Ctrl+F searches.',
    '“Scan my PC” finds the videos already on your computer. You can hide everything it found in Settings — it comes back exactly as it was.',
  ]],
  ['activity', 'Activity', [
    'Everything converting or downloading, with live progress, speed and time left. Stop, skip, retry and see details for anything that failed.',
    'You get a Windows notification when something finishes. Closing Reframe while it’s busy asks first.',
  ]],
  ['brush', 'Make it yours', [
    'Settings › Appearance: four themes (including light), accent colours or your own, animation level, corners, spacing and interface size.',
  ]],
];

function renderHelp() {
  const page = $('#page-help');
  page.innerHTML = '';
  page.append(h('div', { class: 'page-head' },
    h('div', { class: 'head-text' }, h('h1', null, 'Help'), h('div', { class: 'head-sub' }, 'What every part of Reframe does — and how to get the most out of it.'))));
  const grid = h('div', { class: 'help-grid' }, HELP.map(([iconName, title, lines]) => h('div', { class: 'card help-card spot' },
    h('div', { class: 'help-head' }, h('span', { class: 'help-icon' }, ic(iconName, 20)), h('h2', null, title)),
    h('ul', null, lines.map((l) => h('li', null, l))))));
  page.append(grid);
  page.append(h('div', { class: 'card help-keys' },
    h('h2', null, 'Shortcuts'),
    h('div', { class: 'keys' }, [['Ctrl+K', 'Command palette — go anywhere, do anything'], ['Ctrl+O', 'Choose a folder to convert'], ['Ctrl+V', 'Paste a link (on the Downloader)'], ['Ctrl+F', 'Search the library'], ['Ctrl+A', 'Select all videos'], ['Delete', 'Remove from the library'], ['Esc', 'Close / clear selection']]
      .map(([k, d]) => h('div', { class: 'key-row' }, h('kbd', null, k), h('span', null, d))))));
  stagger(grid);
}
