'use strict';
// Ctrl+K command palette: type to jump anywhere or do anything.

function paletteCommands(q) {
  const cmds = [
    ['home', 'Go to Home', () => go('home')],
    ['convert', 'Go to Convert', () => go('convert')],
    ['download', 'Go to Downloader', () => go('download')],
    ['cloud', 'Go to Drives & servers', () => go('sources')],
    ['activity', 'Go to Activity', () => go('activity')],
    ['library', 'Go to Media library', () => go('library')],
    ['settings', 'Go to Settings', () => go('settings')],
    ['info', 'Go to Help', () => go('help')],
    ['folderOpen', 'Convert a folder…', () => chooseSource()],
    ['globe', 'Open the Capture browser', () => api.capture(null)],
    ['clipboard', 'Download the link on my clipboard', async () => { go('download'); fetchLink((await api.readClipboard()).trim()); }],
    ['scan', 'Scan my PC for videos', () => askScan(false)],
    ['import', 'Add a folder of videos to the library…', () => importFolderFlow()],
    ['folder', 'Open my downloads folder', () => api.open(S.settings.downloads.dir)],
    ['bolt', `Turn Turbo ${S.settings.turbo ? 'off' : 'on'}`, async () => { S.settings = await api.setSettings({ turbo: !S.settings.turbo }); updateChrome(); toast(`Turbo is ${S.settings.turbo ? 'on' : 'off'}.`, { kind: 'ok', timeout: 2000 }); }],
    ['brush', `Switch to ${S.settings.appearance.theme === 'light' ? 'dark' : 'light'} theme`, () => setAppearance({ theme: S.settings.appearance.theme === 'light' ? 'graphite' : 'light' }, { rerender: false })],
    ['star', 'Show my favourite videos', () => { go('library'); selectCat('fav'); }],
  ];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = cmds.filter(([, label]) => words.every((w) => label.toLowerCase().includes(w)));
  // Anything typed can also be searched in the library or opened as a link.
  if (q.trim()) {
    if (/^https?:\/\//i.test(q.trim())) {
      list.unshift(['download', `Download ${q.trim().slice(0, 60)}`, () => { go('download'); fetchLink(q.trim()); }],
        ['globe', `Open ${q.trim().slice(0, 60)} in the Capture browser`, () => api.capture(q.trim())]);
    } else {
      list.push(['search', `Search the library for “${q.trim()}”`, () => { go('library'); S.lib.search = q.trim(); selectCat('all'); S.lib.search = q.trim(); renderLibrary(); }]);
    }
  }
  return list.slice(0, 12);
}

function openPalette() {
  if ($('.palette')) return;
  const input = h('input', { class: 'palette-input', placeholder: 'Type a command, a page, a link or something to search…', spellcheck: 'false' });
  const list = h('div', { class: 'palette-list' });
  let sel = 0;
  let items = [];
  const draw = () => {
    items = paletteCommands(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = '';
    items.forEach(([iconName, label, run], i) => list.append(h('button', {
      class: `palette-item ${i === sel ? 'on' : ''}`,
      onmouseenter: () => { sel = i; list.querySelectorAll('.palette-item').forEach((b, j) => b.classList.toggle('on', j === sel)); },
      onclick: () => { close(); run(); },
    }, ic(iconName, 16), h('span', null, label))));
    if (!items.length) list.append(h('div', { class: 'palette-none' }, 'Nothing matches.'));
  };
  const close = modal({ className: 'palette', body: h('div', null, h('div', { class: 'palette-search' }, ic('search', 18), input, h('kbd', null, 'Esc')), list) });
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { const run = items[sel][2]; close(); run(); }
  });
  draw();
  setTimeout(() => input.focus(), 30);
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  }
}, true);
