'use strict';
// Home: what's happening now, lifetime totals, quick actions, recent videos
// and the state of every engine — at a glance.

const TIPS = [
  ['Ctrl+K', 'opens the command palette — type to jump anywhere or do anything.'],
  ['Turbo', 'in the Convert page uses your graphics card. Great for long or HD videos.'],
  ['Right-click', 'a picture or video in the Capture browser to save it, save it as, or copy it.'],
  ['Pictures', 'in the Capture browser saves a whole comic chapter as one .cbz file.'],
  ['Your own sites', ': drop .txt files of links into Documents › Reframe Other Sites and they appear in the Downloader.'],
  ['Run a folder again', 'and only the new videos are converted — the rest are skipped.'],
  ['Hover', 'a video in the library to watch a silent preview.'],
  ['The shield', 'in the Capture browser turns ads off for just the site you’re on, if it breaks.'],
  ['Paste several links', 'at once into the Downloader and they all queue up.'],
  ['Drag', 'videos onto a category in the library side bar to sort them.'],
];

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

function renderHome() {
  const page = $('#page-home');
  page.innerHTML = '';
  const st = S.settings.stats || {};
  const lib = visibleLibrary();
  const jobs = [...S.jobs.values()];
  const active = jobs.filter((j) => ACTIVE.includes(j.status));

  page.append(h('div', { class: 'home-hero' },
    h('img', { class: 'home-logo', src: 'assets/logo.svg', width: 56, height: 56, alt: '' }),
    h('div', null,
      h('h1', null, `${greeting()}.`),
      h('div', { class: 'eyebrow' }, 'You reframe a picture. ', h('b', null, 'We reframe a video.')))));

  // ---- lifetime totals ----
  const tiles = h('div', { class: 'home-stats' });
  const tile = (iconName, label, value, fmt, go2) => {
    const v = h('div', { class: 'ls-value' });
    tiles.append(h('button', { class: 'ls spot home-stat', onclick: go2 }, h('span', { class: 'ls-icon' }, ic(iconName, 18)), h('div', null, v, h('div', { class: 'ls-label' }, label))));
    countUp(v, value, { format: fmt });
  };
  const n = (x) => Math.round(x).toLocaleString();
  tile('film', 'videos in your library', lib.videos.length, n, () => go('library'));
  tile('sparkles', `saved by converting ${(st.converted || 0).toLocaleString()} videos`, st.savedBytes || 0, (x) => fmtBytes(x), () => go('activity'));
  tile('download', `downloads · ${fmtBytes(st.downloadBytes || 0)}`, st.downloads || 0, n, () => go('download'));
  tile('layers', 'comics & galleries saved', st.comics || 0, n, () => go('download'));
  page.append(tiles);

  const grid = h('div', { class: 'home-grid' });

  // ---- right now ----
  const now = h('div', { class: 'card home-now' }, h('div', { class: 'card-head' }, h('h2', null, 'Right now'), active.length ? btn('Open Activity', { kind: 'ghost sm', icon: 'activity', onClick: () => go('activity') }) : null));
  if (!active.length) {
    now.append(h('div', { class: 'quiet' }, ic('check', 22), h('div', null, h('b', null, 'All quiet.'), h('div', { class: 'card-sub' }, 'Nothing is converting or downloading.'))));
  } else {
    for (const j of active.slice(0, 5)) {
      const conv = j.kind !== 'download';
      const nums = conv ? jobNumbers(j) : null;
      const frac = conv ? nums.fraction : j.progress;
      now.append(h('div', { class: 'now-mini' },
        h('span', { class: 'now-mini-icon' }, ic(conv ? 'convert' : 'download', 16)),
        h('div', { class: 'now-mini-text' },
          h('div', { class: 'now-mini-title' }, conv ? j.name : j.title),
          h('div', { class: 'bar' }, h('i', { style: { width: `${Math.max(2, frac * 100)}%` } })),
          h('div', { class: 'card-sub' }, conv
            ? `${nums.finished} of ${plural(j.items.length, 'video')} · ${Math.floor(frac * 100)}%${nums.eta ? ` · ${fmtEta(nums.eta).toLowerCase()}` : ''}`
            : `${j.status === 'queued' ? 'Waiting' : `${Math.floor(frac * 100)}%`}${j.speed ? ` · ${j.speed}` : ''}${j.eta ? ` · ${j.eta} left` : ''}${j.phase ? ` · ${j.phase}` : ''}`))));
    }
  }
  grid.append(now);

  // ---- quick actions ----
  const linkIn = h('input', { class: 'input', placeholder: 'Paste a video link and press Enter', spellcheck: 'false' });
  linkIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && linkIn.value.trim()) {
      go('download');
      fetchLink(linkIn.value.trim());
    }
  });
  const action = (iconName, title, sub, run) => h('button', { class: 'home-action spot', onclick: run },
    h('span', { class: 'help-icon' }, ic(iconName, 20)), h('div', null, h('div', { class: 'ha-title' }, title), h('div', { class: 'card-sub' }, sub)));
  grid.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Quick start')),
    h('label', { class: 'lib-search home-link' }, ic('link', 16), linkIn),
    h('div', { class: 'home-actions' },
      action('folderOpen', 'Convert a folder', 'Every video, every subfolder', () => chooseSource()),
      action('globe', 'Capture browser', 'Browse any site, save its video or pictures', () => api.capture(null)),
      action('scan', 'Find videos on my PC', 'Sort them into your library', () => askScan(false)),
      action('cloud', 'Drives & servers', 'USB, NAS, cloud, Plex, Jellyfin', () => go('sources')))));
  page.append(grid);

  // ---- recently added ----
  const recent = [...lib.videos].sort((a, b) => b.addedAt - a.addedAt).slice(0, 8);
  if (recent.length) {
    page.append(h('div', { class: 'section-label' }, 'Recently added'));
    const strip = h('div', { class: 'home-recent' }, recent.map((v) => h('button', { class: 'recent-card', title: v.path, onclick: () => playVideo(v) },
      h('div', { class: 'vthumb' }, v.thumb && v.thumb !== 'none' ? h('img', { class: 'vimg', src: thumbUrl(v), alt: '' }) : h('div', { class: 'vthumb-ph' }, ic('film', 22)),
        v.duration ? h('span', { class: 'vdur' }, fmtDuration(v.duration)) : null),
      h('div', { class: 'vtitle' }, videoTitle(v)))));
    page.append(strip);
    stagger(strip);
  }

  // ---- engines + tip ----
  const T = S.tools || { ytdlp: {}, ffmpeg: {} };
  const gpu = S.info.gpu || {};
  const chip = (ok, label, detail, onClick) => h('button', { class: `engine-chip ${ok ? 'ok' : 'warn'}`, title: detail, onclick: onClick }, h('span', { class: `status-dot ${ok ? 'ok' : 'warn'}` }), label);
  const tip = TIPS[Math.floor(Date.now() / 86400000) % TIPS.length];
  page.append(h('div', { class: 'home-foot' },
    h('div', { class: 'card home-engines' },
      h('div', { class: 'card-head' }, h('h2', null, 'Engines')),
      h('div', { class: 'engine-chips' },
        chip(S.info.cli.exists, 'HandBrake', S.info.cli.exists ? 'Converting is ready' : 'Not found — open Settings', () => go('settings')),
        chip(T.ytdlp.installed, T.ytdlp.installed ? `yt-dlp ${T.ytdlp.version || ''}`.trim() : 'yt-dlp — set up', T.ytdlp.installed ? 'Downloads from 1,700+ sites' : 'Needed for website downloads', () => go(T.ytdlp.installed ? 'settings' : 'download')),
        chip(T.ffmpeg.installed, T.ffmpeg.installed ? 'FFmpeg' : 'FFmpeg — install', T.ffmpeg.installed ? 'Full HD/4K downloads, previews, thumbnails' : 'Needed for HD downloads and previews', () => go('settings')),
        chip(!!(gpu.encoders && gpu.encoders.length), gpu.encoders && gpu.encoders.length ? `Turbo: ${gpu.name || 'graphics card'}` : 'Turbo unavailable', S.settings.turbo ? 'Turbo is on' : 'Turbo is off — switch it on in Settings or the Convert page', () => go('settings')),
        chip(true, 'Ad blocker (Capture browser)', 'uBlock Origin ad lists, built in', () => api.capture(null)))),
    h('div', { class: 'card home-tip spot' }, h('span', { class: 'help-icon' }, ic('sparkles', 20)), h('div', null, h('div', { class: 'card-sub' }, 'Tip'), h('div', null, h('b', null, tip[0]), ' ', tip[1])))));
  stagger(page);
}
