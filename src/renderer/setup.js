'use strict';
// First-run setup: a short guided tour that gets Reframe ready to use.

function openSetup() {
  const box = h('div', { class: 'setup-body' });
  let step = 0;
  let close = null;
  const steps = ['welcome', 'look', 'folder', 'engines', ...(S.info.sfwOnly ? [] : ['adult']), 'videos', 'done'];

  const finish = async (scan) => {
    S.settings = await api.setSettings({ firstRunDone: true, setupDone: true });
    close();
    if (scan) startScan();
    go('home');
    confetti();
  };

  const nav = (canNext = true, nextLabel = 'Next') => h('div', { class: 'setup-nav' },
    h('div', { class: 'setup-dots' }, steps.map((_, i) => h('i', { class: i === step ? 'on' : i < step ? 'done' : '' }))),
    h('div', { class: 'setup-btns' },
      step > 0 ? btn('Back', { kind: 'ghost', onClick: () => { step--; draw(); } }) : btn('Skip setup', { kind: 'ghost', onClick: () => finish(false) }),
      btn(nextLabel, { kind: 'primary', icon: 'arrowRight', disabled: !canNext, onClick: () => { step++; draw(); } })));

  const page = (iconName, title, text, ...content) => h('div', { class: 'setup-page' },
    h('div', { class: 'setup-icon' }, iconName === 'logo' ? h('img', { src: 'assets/logo.svg', width: 84, height: 84, alt: '' }) : ic(iconName, 30)),
    h('h2', null, title),
    text ? h('p', { class: 'setup-text' }, text) : null,
    ...content);

  function draw() {
    box.innerHTML = '';
    const ap = S.settings.appearance;
    const T = S.tools || { ytdlp: {}, ffmpeg: {} };
    const which = steps[step];
    if (which === 'welcome') {
      box.append(page('logo', 'Welcome to Reframe', null,
        h('div', { class: 'eyebrow center' }, 'You reframe a picture. ', h('b', null, 'We reframe a video.')),
        h('ul', { class: 'setup-list' },
          h('li', null, ic('convert', 16), 'Convert whole folders with HandBrake — every subfolder stays in place'),
          h('li', null, ic('download', 16), 'Download videos from 1,700+ sites, plus any page through the Capture browser'),
          h('li', null, ic('layers', 16), 'Save comics and galleries as .cbz files'),
          h('li', null, ic('library', 16), 'Keep everything in a sorted media library')),
        h('p', { class: 'fine' }, 'This takes under a minute. You can change everything later in Settings.')), nav(true, 'Let’s go'));
    } else if (which === 'look') {
      box.append(page('brush', 'Pick your look', 'Change it any time in Settings › Appearance.',
        h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, t]) => h('button', {
          class: `theme-card ${ap.theme === id ? 'on' : ''}`,
          style: { '--tbg': t.bg, '--tpanel': t.panel },
          onclick: () => { setAppearance({ theme: id }, { rerender: false }); draw(); },
        }, h('div', { class: 'theme-prev' }, h('i', { class: 'tp-side' }), h('i', { class: 'tp-card' }), h('i', { class: 'tp-card b' }), h('i', { class: 'tp-accent' })), h('span', null, t.name)))),
        h('div', { class: 'swatches center' }, Object.entries(ACCENTS).map(([id, a]) => h('button', {
          class: `swatch-btn ${ap.accent === id ? 'on' : ''}`,
          title: a.name,
          style: { background: `linear-gradient(135deg, ${a.g[0]}, ${a.g[1]}, ${a.g[2]})` },
          onclick: () => { setAppearance({ accent: id }, { rerender: false }); draw(); },
        }, ap.accent === id ? ic('check', 14) : null)))), nav());
    } else if (which === 'folder') {
      const ds = S.settings.downloads;
      box.append(page('folder', 'Where should downloads go?', 'Videos, music and comics you download are saved here, sorted by site.',
        h('div', { class: 'path-field setup-path' },
          h('span', { class: 'path-icon' }, ic('folder', 18)),
          h('div', { class: 'path-text' }, h('div', { class: 'path-name' }, baseName(ds.dir)), h('div', { class: 'path-dir', title: ds.dir }, ds.dir)),
          btn('Change', { kind: 'ghost', onClick: async () => {
            const p = await api.pickFolder({ title: 'Where should downloads go?', defaultPath: ds.dir });
            if (p) {
              S.settings = await api.setSettings({ downloads: { dir: p } });
              draw();
            }
          } }))), nav());
    } else if (which === 'engines') {
      const row = (name, label, hint) => h('div', { class: 'setup-engine' },
        h('span', { class: `status-dot ${T[name].installed ? 'ok' : 'warn'}` }),
        h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), h('div', { class: 'set-hint' }, T[name].installed ? 'Installed ✓' : hint), toolProgressBar(name)),
        T[name].installed ? null : btn(S.toolProgress[name] ? 'Downloading…' : 'Install', { kind: 'primary sm', icon: 'download', disabled: !!S.toolProgress[name], onClick: async () => { await installTool(name); draw(); } }));
      box.append(page('cpu', 'Download engines', 'HandBrake is built in. These two free tools are fetched from their official pages when you want them.',
        h('div', { class: 'setup-engines' },
          h('div', { class: 'setup-engine' }, h('span', { class: `status-dot ${S.info.cli.exists ? 'ok' : 'bad'}` }), h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'HandBrake (converting)'), h('div', { class: 'set-hint' }, S.info.cli.exists ? 'Built in ✓' : 'Not found — set it in Settings'))),
          row('ytdlp', 'yt-dlp (downloads from websites)', '23 MB · needed to download from YouTube, TikTok and 1,700+ other sites'),
          row('ffmpeg', 'FFmpeg (HD quality, previews)', '91 MB · joins HD video and sound, makes previews and thumbnails')),
        h('p', { class: 'fine' }, 'You can skip this and install them later from Settings.')), nav());
    } else if (which === 'adult') {
      box.append(page('shield', '18+ content', 'Reframe can list adult websites in the Downloader. It’s hidden unless you turn it on.',
        h('div', { class: 'setup-choices' },
          h('button', { class: `setup-choice ${!S.settings.showAdult ? 'on' : ''}`, onclick: async () => { S.settings = await api.setSettings({ showAdult: false }); draw(); } },
            ic('eyeOff', 22), h('b', null, 'Keep 18+ hidden'), h('span', null, 'Recommended')),
          h('button', { class: `setup-choice ${S.settings.showAdult ? 'on' : ''}`, onclick: async () => {
            if (!(await confirmBox({ title: 'Are you 18 or older?', message: 'Only turn this on if you are an adult and it’s legal where you live.', confirm: 'I’m 18 or older' }))) return;
            S.settings = await api.setSettings({ showAdult: true });
            draw();
          } }, ic('eye', 22), h('b', null, 'Show 18+ sites'), h('span', null, 'I’m 18 or older')))), nav());
    } else if (which === 'videos') {
      box.append(page('scan', 'Find the videos already on your PC?', 'Reframe can look through your Videos, Downloads, Desktop, Documents and other drives (skipping Windows, programs and games) and sort what it finds into your library. Nothing is moved or uploaded.',
        h('div', { class: 'setup-choices' },
          h('button', { class: 'setup-choice', onclick: () => finish(true) }, ic('scan', 22), h('b', null, 'Yes, scan my PC'), h('span', null, 'Takes a minute or two')),
          h('button', { class: 'setup-choice', onclick: () => { step++; draw(); } }, ic('x', 22), h('b', null, 'Not now'), h('span', null, 'You can do it later from the library')))),
      h('div', { class: 'setup-nav' }, h('div', { class: 'setup-dots' }, steps.map((_, i) => h('i', { class: i === step ? 'on' : i < step ? 'done' : '' }))), h('div', { class: 'setup-btns' }, btn('Back', { kind: 'ghost', onClick: () => { step--; draw(); } }))));
    } else {
      box.append(page('check', 'You’re all set', null,
        h('ul', { class: 'setup-list' },
          h('li', null, h('kbd', null, 'Ctrl+K'), 'opens the command palette — go anywhere, do anything'),
          h('li', null, ic('info', 16), 'Help in the side bar explains every part of the app'),
          h('li', null, ic('tiktok', 16), 'Made by @chr0m3void — say hi on TikTok'))),
      h('div', { class: 'setup-nav' }, h('div', { class: 'setup-dots' }, steps.map((_, i) => h('i', { class: i === step ? 'on' : 'done' }))), h('div', { class: 'setup-btns' }, btn('Start using Reframe', { kind: 'primary', icon: 'sparkles', onClick: () => finish(false) }))));
    }
    stagger(box.querySelector('.setup-page'));
  }

  // Closing it any other way (Esc, clicking outside) still counts as done.
  close = modal({ className: 'setup', wide: true, body: box, onClose: () => {
    if (!S.settings.setupDone) api.setSettings({ firstRunDone: true, setupDone: true }).then((s) => { S.settings = s; });
  } });
  draw();
}
