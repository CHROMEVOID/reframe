'use strict';
// Settings page.

const TIKTOK = 'https://www.tiktok.com/@chr0m3void';

function seg(options, value, onPick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: String(value) === String(v) ? 'on' : '', onclick: () => onPick(v) }, label)));
}

function renderSettings() {
  const page = $('#page-settings');
  const keep = page.scrollTop;
  const st = S.settings;
  const ap = st.appearance;
  const info = S.info;
  page.innerHTML = '';

  const set = (k, rerender = false) => async (v) => {
    S.settings = await api.setSettings({ [k]: v });
    if (rerender) renderSettings();
  };

  page.append(h('div', { class: 'page-head' },
    h('div', { class: 'head-text' }, h('h1', null, 'Settings'), h('div', { class: 'head-sub' }, 'Changes are saved straight away.'))));

  // ---------- appearance ----------
  const themeCards = h('div', { class: 'theme-grid' }, Object.entries(THEMES).map(([id, t]) => h('button', {
    class: `theme-card ${ap.theme === id ? 'on' : ''}`,
    style: { '--tbg': t.bg, '--tpanel': t.panel },
    onclick: () => setAppearance({ theme: id }),
  },
  h('div', { class: 'theme-prev' }, h('i', { class: 'tp-side' }), h('i', { class: 'tp-card' }), h('i', { class: 'tp-card b' }), h('i', { class: 'tp-accent' })),
  h('span', null, t.name),
  ap.theme === id ? ic('check', 14, 'theme-check') : null)));

  const customInput = h('input', { type: 'color', class: 'color-input', value: ap.custom || '#ff5e62', title: 'Pick your own colour' });
  customInput.addEventListener('input', () => setAppearance({ accent: 'custom', custom: customInput.value }, { rerender: false }));
  customInput.addEventListener('change', () => renderSettings());
  const swatches = h('div', { class: 'swatches' },
    Object.entries(ACCENTS).map(([id, a]) => h('button', {
      class: `swatch-btn ${ap.accent === id ? 'on' : ''}`,
      title: a.name,
      style: { background: `linear-gradient(135deg, ${a.g[0]}, ${a.g[1]}, ${a.g[2]})` },
      onclick: () => setAppearance({ accent: id }),
    }, ap.accent === id ? ic('check', 14) : null)),
    h('label', { class: `swatch-btn custom ${ap.accent === 'custom' ? 'on' : ''}`, title: 'Your own colour' }, ic('palette', 15), customInput));

  const appearance = h('div', { class: 'card appearance-card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Appearance'), h('p', { class: 'card-sub' }, 'Make Reframe look the way you like.')), ic('brush', 20, 'card-head-icon')),
    h('div', { class: 'set-block' }, h('div', { class: 'set-label' }, 'Theme'), themeCards),
    h('div', { class: 'set-block' }, h('div', { class: 'set-label' }, 'Accent colour'), swatches),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Animations'), h('div', { class: 'set-hint' }, 'How much things move, glow and grow when you hover.')),
      seg([['full', 'Full'], ['subtle', 'Subtle'], ['off', 'Off']], ap.motion, (v) => setAppearance({ motion: v }))),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Corners')),
      seg([['round', 'Round'], ['soft', 'Soft'], ['sharp', 'Sharp']], ap.radius, (v) => setAppearance({ radius: v }))),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Spacing')),
      seg([['comfortable', 'Comfy'], ['compact', 'Compact']], ap.density, (v) => setAppearance({ density: v }))),
    h('div', { class: 'options' },
      toggle({ iconName: 'sparkles', label: 'Animated background glow', checked: ap.aurora !== false, onChange: (v) => setAppearance({ aurora: v }) }),
      toggle({ iconName: 'play', label: 'Intro animation when Reframe opens', checked: ap.splash !== false, onChange: (v) => setAppearance({ splash: v }) })),
    h('div', { class: 'card-foot' }, btn('Reset to default look', {
      kind: 'ghost sm',
      icon: 'retry',
      onClick: () => setAppearance({ accent: 'ember', theme: 'graphite', motion: 'full', radius: 'round', density: 'comfortable', zoom: 1, aurora: true, splash: true, cardSize: 230 }),
    })));

  // ---------- HandBrake ----------
  const engineOk = info.cli.exists;
  const engine = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'HandBrake')),
    h('div', { class: 'set-row' },
      h('span', { class: `status-dot ${engineOk ? 'ok' : 'bad'}` }),
      h('div', { class: 'set-text' },
        h('div', { class: 'set-label' }, engineOk ? 'HandBrake engine ready' : 'HandBrake engine not found'),
        h('div', { class: 'set-hint mono', title: info.cli.path }, info.cli.bundled ? 'Built in (HandBrakeCLI 1.11.2)' : info.cli.path)),
      btn('Choose…', {
        kind: 'ghost',
        onClick: async () => {
          const p = await api.pickFile({ title: 'Find HandBrakeCLI.exe', filters: [{ name: 'HandBrakeCLI', extensions: ['exe'] }] });
          if (!p) return;
          if (!/handbrakecli\.exe$/i.test(p)) {
            toast('That is not HandBrakeCLI.exe. The HandBrake app itself (HandBrake.exe) cannot be controlled — choose HandBrakeCLI.exe.', { kind: 'warn', timeout: 8000 });
            return;
          }
          S.settings = await api.setSettings({ cliPath: p });
          S.info = await api.info();
          renderSettings();
          updateChrome();
        },
      }),
      !info.cli.bundled ? btn('Use built-in', {
        kind: 'ghost',
        onClick: async () => {
          S.settings = await api.setSettings({ cliPath: '' });
          S.info = await api.info();
          renderSettings();
          updateChrome();
        },
      }) : null),
    h('div', { class: 'set-row' },
      h('span', { class: `status-dot ${S.presets.source ? 'ok' : 'warn'}` }),
      h('div', { class: 'set-text' },
        h('div', { class: 'set-label' }, S.presets.source ? `${S.presets.groups.reduce((n, g) => n + g.presets.length, 0)} presets from your HandBrake app` : 'Using the standard presets'),
        h('div', { class: 'set-hint mono', title: S.presets.source || info.defaultPresetsFile }, S.presets.source || 'Your HandBrake presets file was not found')),
      btn('Reload', {
        kind: 'ghost',
        icon: 'retry',
        onClick: async () => {
          S.presets = await api.reloadPresets();
          renderSettings();
          toast('Presets reloaded from HandBrake', { kind: 'ok', timeout: 2500 });
        },
      }),
      btn('Choose file…', {
        kind: 'ghost',
        onClick: async () => {
          const p = await api.pickFile({ title: 'Choose a HandBrake presets file', filters: [{ name: 'HandBrake presets', extensions: ['json'] }] });
          if (!p) return;
          S.settings = await api.setSettings({ presetsPath: p });
          S.presets = await api.reloadPresets();
          renderSettings();
        },
      })),
    h('p', { class: 'card-foot-note' }, 'Make or change presets in the HandBrake app, then press Reload — your own presets show up first in the preset list.'));

  // ---------- converting ----------
  const suffixInput = h('input', { class: 'input', value: st.suffix, spellcheck: 'false' });
  const example = h('span', { class: 'mono' });
  const drawExample = () => { example.textContent = `Holiday${suffixInput.value || ' converted'}`; };
  drawExample();
  suffixInput.addEventListener('input', drawExample);
  suffixInput.addEventListener('change', async () => {
    S.settings = await api.setSettings({ suffix: suffixInput.value });
    suffixInput.value = S.settings.suffix;
    drawExample();
  });
  const gpuOk = info.gpu && info.gpu.encoders && info.gpu.encoders.length;
  const conversion = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Converting')),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Name of the copy'), h('div', { class: 'set-hint' }, 'Added to the end of the folder name: ', example)),
      h('div', { class: 'set-control' }, suffixInput)),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Videos at the same time'), h('div', { class: 'set-hint' }, 'Auto runs a few side by side when the preset can’t keep your processor busy on its own — same quality, finished sooner.')),
      seg([[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], st.concurrency, set('concurrency', true))),
    h('div', { class: 'options' },
      toggle({ iconName: 'bolt', label: 'Turbo — use the graphics card', hint: gpuOk ? `Encodes on ${info.gpu.name || 'your graphics card'} (${info.gpu.encoders.join(', ')}). Faster, most of all on long or HD videos; files can be a little bigger.` : 'No supported graphics card found.', checked: st.turbo && gpuOk, disabled: !gpuOk, onChange: set('turbo') }),
      toggle({ iconName: 'gauge', label: 'Keep my PC responsive', hint: 'Runs HandBrake at a lower priority so games and apps stay smooth. Turn off for maximum speed.', checked: st.lowPriority, onChange: set('lowPriority') }),
      toggle({ iconName: 'bell', label: 'Notify me when something is done', checked: st.notify, onChange: set('notify') }),
      toggle({ iconName: 'external', label: 'Open the copy when it’s done', checked: st.openWhenDone, onChange: set('openWhenDone') })));

  // ---------- library & scan ----------
  const scanned = S.library.videos.filter((v) => v.origin === 'scan').length;
  const lib = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Media library')),
    h('div', { class: 'options' },
      toggle({
        iconName: st.showScanned === false ? 'eyeOff' : 'eye',
        label: 'Show videos found on my PC',
        hint: st.showScanned === false
          ? `${scanned.toLocaleString()} videos are hidden. Turn this back on and they reappear instantly, sorted exactly as before.`
          : 'Turn off to hide everything the PC scan found. Nothing is forgotten — it all comes back when you turn it on.',
        checked: st.showScanned !== false,
        onChange: async (v) => {
          S.settings = await api.setSettings({ showScanned: v });
          renderSettings();
          updateChrome();
        },
      }),
      toggle({ iconName: 'sparkles', label: 'Sort into categories automatically', hint: 'A folder with folders inside becomes a category with categories inside.', checked: st.autoCategorize, onChange: set('autoCategorize') })),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Scan my PC for videos'), h('div', { class: 'set-hint' }, scanned ? `${scanned.toLocaleString()} videos found so far. Scanning again adds anything new.` : 'Finds the videos already on your computer and sorts them by where they are.')),
      btn(S.scan && S.scan.running ? 'Scanning…' : 'Scan now', { kind: 'primary', icon: 'scan', disabled: !!(S.scan && S.scan.running), onClick: () => askScan(false) })),
    scanned ? h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Forget scan results'), h('div', { class: 'set-hint' }, 'Removes what the scan found from the library. No files are deleted.')),
      btn('Forget', {
        kind: 'ghost danger-text',
        icon: 'trash',
        onClick: async () => {
          if (await confirmBox({ title: 'Forget the scan results?', message: 'Videos found by the PC scan and their categories are removed from the library. The files stay on your PC.', confirm: 'Forget', danger: true })) {
            await api.library.forgetScanned();
            renderSettings();
          }
        },
      })) : null,
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Thumbnails'), h('div', { class: 'set-hint' }, 'Make the preview pictures again, e.g. after a video was replaced.')),
      btn('Rebuild', { kind: 'ghost', icon: 'retry', onClick: async () => { await api.library.clearThumbs(); toast('Rebuilding thumbnails…', { timeout: 2500 }); } })),
    h('div', { class: 'set-row' },
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, 'Empty the library'), h('div', { class: 'set-hint' }, 'Removes every video and category from Reframe. No files are deleted.')),
      btn('Empty library', {
        kind: 'ghost danger-text',
        icon: 'trash',
        onClick: async () => {
          const ok = await confirmBox({ title: 'Empty the library?', message: 'Every video and category is removed from Reframe. The video files on your PC are not deleted.', confirm: 'Empty library', danger: true });
          if (ok) await api.library.reset();
        },
      })));

  // ---------- downloader tools ----------
  const T = S.tools || { ytdlp: {}, ffmpeg: {} };
  const toolRow = (name, label, okText, hint) => h('div', { class: 'set-row' },
    h('span', { class: `status-dot ${T[name].installed ? 'ok' : 'warn'}` }),
    h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), h('div', { class: 'set-hint' }, T[name].installed ? okText : hint), toolProgressBar(name)),
    btn(S.toolProgress[name] ? 'Downloading…' : T[name].installed ? 'Update' : 'Install', { kind: T[name].installed ? 'ghost' : 'primary', icon: 'download', disabled: !!S.toolProgress[name], onClick: () => installTool(name) }));
  const dlTools = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Downloader')),
    toolRow('ytdlp', 'Video engine (yt-dlp)', `Installed${T.ytdlp.version ? ` — version ${T.ytdlp.version}` : ''}. Update now and then: sites change often.`, 'Needed to download from websites. 23 MB.'),
    toolRow('ffmpeg', 'FFmpeg', 'Installed — downloads come in full quality, and thumbnails work for every format.', 'Joins HD video and sound, and makes thumbnails for AVI, WMV and more. 91 MB.'),
    info.sfwOnly ? null : h('div', { class: 'options' },
      toggle({
        iconName: 'eyeOff',
        label: 'Show 18+ sites in the site list',
        hint: 'Adds the adult section to the Downloader’s list of supported sites. Off by default.',
        checked: !!st.showAdult,
        onChange: async (v) => {
          if (v && !(await confirmBox({ title: 'Are you 18 or older?', message: 'The 18+ section lists adult websites. Only turn it on if you are an adult and it’s legal where you live.', confirm: 'I’m 18 or older' }))) {
            renderSettings();
            return;
          }
          S.settings = await api.setSettings({ showAdult: v });
          renderSettings();
        },
      })));

  // ---------- about & credits ----------
  const about = h('div', { class: 'card about-card spot' },
    h('div', { class: 'about-top' },
      h('img', { class: 'about-logo', src: 'assets/logo.svg', width: 72, height: 72, alt: '' }),
      h('div', { class: 'set-text' },
        h('div', { class: 'about-name' }, 'Reframe', h('span', { class: 'mini-pill' }, `v${info.version}`)),
        h('div', { class: 'about-slogan' }, 'You reframe a picture. ', h('b', null, 'We reframe a video.')))),
    h('button', { class: 'tiktok-card tilt', onclick: () => api.external(TIKTOK) },
      h('div', { class: 'tt-icon' }, ic('tiktok', 26)),
      h('div', { class: 'tt-text' }, h('div', { class: 'tt-small' }, 'Made by'), h('div', { class: 'tt-name' }, '@chr0m3void'), h('div', { class: 'tt-cta' }, 'Follow my TikTok')),
      ic('external', 18, 'tt-go')),
    h('div', { class: 'credits' },
      h('div', { class: 'set-label' }, 'Credits'),
      h('ul', null,
        h('li', null, h('b', null, 'Design & idea'), ' — chr0m3void (TikTok @chr0m3void · guns.lol/chromevoid)'),
        h('li', null, h('b', null, 'HandBrake'), ' — the HandBrake Team, GNU GPL v2'),
        h('li', null, h('b', null, 'yt-dlp'), ' — the yt-dlp contributors, Unlicense (downloaded on request)'),
        h('li', null, h('b', null, 'FFmpeg'), ' — the FFmpeg developers, GNU GPL (downloaded on request)'),
        h('li', null, h('b', null, 'Electron'), ' — OpenJS Foundation, MIT'))),
    h('div', { class: 'about-links' },
      btn('guns.lol/chromevoid', { kind: 'ghost sm', icon: 'link', onClick: () => api.external('https://guns.lol/chromevoid') }),
      btn('handbrake.fr', { kind: 'ghost sm', icon: 'external', onClick: () => api.external('https://handbrake.fr/') }),
      btn('yt-dlp', { kind: 'ghost sm', icon: 'external', onClick: () => api.external('https://github.com/yt-dlp/yt-dlp') })));

  const grid = h('div', { class: 'settings-grid' }, appearance, eyesCard('Reframe'), conversion, lib, dlTools, engine, about);
  page.append(grid);
  page.scrollTop = keep;
}
