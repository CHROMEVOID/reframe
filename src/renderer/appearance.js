'use strict';
// Look & feel: theme, accent colour, motion, corners, density, size.

// Accent colours: a three-stop gradient (g) and the solid colour used for
// text, outlines and switches (a).
const ACCENTS = {
  ember: { name: 'Ember', g: ['#ffb04a', '#ff4f73', '#9b5cff'], a: '#ff5e62' },
  sunset: { name: 'Sunset', g: ['#ffd36e', '#ff7a59', '#e2457a'], a: '#ff7a59' },
  peach: { name: 'Peach', g: ['#ffe4c7', '#ffa781', '#ff7aa8'], a: '#ff9a76' },
  coral: { name: 'Coral', g: ['#ffcfb3', '#ff7f6b', '#e05561'], a: '#ff7f6b' },
  crimson: { name: 'Crimson', g: ['#ffa8a8', '#ef4444', '#be123c'], a: '#f43f5e' },
  rose: { name: 'Rose', g: ['#ffc2d6', '#ff5d9e', '#c2185b'], a: '#ff5d9e' },
  gold: { name: 'Gold', g: ['#fde68a', '#f59e0b', '#ef4444'], a: '#f5a524' },
  copper: { name: 'Copper', g: ['#ffe0a3', '#e8a33d', '#b5651d'], a: '#e8a33d' },
  lime: { name: 'Lime', g: ['#ecfccb', '#a3e635', '#22c55e'], a: '#9ad93a' },
  mint: { name: 'Mint', g: ['#bbf7d0', '#34d399', '#0ea5e9'], a: '#2ecf95' },
  forest: { name: 'Forest', g: ['#bbf7d0', '#22a06b', '#166534'], a: '#2fb57a' },
  teal: { name: 'Teal', g: ['#a5f3fc', '#14b8a6', '#0f766e'], a: '#19c2b0' },
  sky: { name: 'Sky', g: ['#bae6fd', '#38bdf8', '#2563eb'], a: '#38a8f8' },
  ocean: { name: 'Ocean', g: ['#5ee7ff', '#3b82f6', '#6d5cff'], a: '#3b9bff' },
  ice: { name: 'Ice', g: ['#f0f9ff', '#a5d8ff', '#6c9fd6'], a: '#8fc4f5' },
  indigo: { name: 'Indigo', g: ['#c7d2fe', '#6366f1', '#3730a3'], a: '#7074f5' },
  violet: { name: 'Violet', g: ['#f0abfc', '#a855f7', '#6366f1'], a: '#a855f7' },
  lavender: { name: 'Lavender', g: ['#f3e8ff', '#c4a1ff', '#8b5cf6'], a: '#b98cff' },
  aurora: { name: 'Aurora', g: ['#7cf7c8', '#5aa9ff', '#c084fc'], a: '#5aa9ff' },
  neon: { name: 'Neon', g: ['#00ffd1', '#00b3ff', '#ff3df2'], a: '#00ccff' },
  mono: { name: 'Mono', g: ['#ffffff', '#c7cbd6', '#7c8394'], a: '#d6d9e0' },
};

// Themes: the colours here are for previews, the title bar and the Capture
// bar; the full set for each one is in the style sheets.
const THEMES = {
  slate: { name: 'Slate', bg: '#0c1015', panel: '#151b24', text: '#9fa9b8' },
  graphite: { name: 'Graphite', bg: '#0b0c10', panel: '#14161c', text: '#a3a9b8' },
  midnight: { name: 'Midnight', bg: '#000000', panel: '#0d0d11', text: '#a3a9b8' },
  ocean: { name: 'Deep blue', bg: '#060a14', panel: '#0f182c', text: '#a3b1cc' },
  frost: { name: 'Frost', bg: '#11151d', panel: '#1b2130', text: '#a9b4c8' },
  forest: { name: 'Forest', bg: '#08110d', panel: '#112019', text: '#9fb8aa' },
  plum: { name: 'Plum', bg: '#110a16', panel: '#1d1326', text: '#b3a3c4' },
  mocha: { name: 'Mocha', bg: '#14100d', panel: '#211a15', text: '#b8a998' },
  light: { name: 'Light', bg: '#e4e7ee', panel: '#ffffff', text: '#4a5164', light: true },
  paper: { name: 'Paper', bg: '#e9e1cf', panel: '#fbf6ea', text: '#5b5040', light: true },
  cloud: { name: 'Cloud', bg: '#dfe8f3', panel: '#f7fbff', text: '#45536a', light: true },
  blush: { name: 'Blush', bg: '#f0e1e6', panel: '#fff8fa', text: '#5e4952', light: true },
};

function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const HEX = /^#[0-9a-f]{6}$/i;
const rgbOf = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hexOf = (r, g, b) => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;

// a + (b − a) × t: a colour part of the way from a to b.
function mixHex(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return hexOf(...x.map((c, i) => c + (y[i] - c) * t));
}

// Colour strength: pull a colour towards grey (muted) or away from it (vivid).
function saturate(hex, f) {
  const [r, g, b] = rgbOf(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = (v) => Math.max(0, Math.min(255, grey + (v - grey) * f));
  return hexOf(c(r), c(g), c(b));
}

// The accent colours for a look, ready to use: { g: [3 stops], accent }.
// Shared by the main window and the Capture browser bar.
function lookColours(a, theme) {
  let g;
  let accent;
  const p = ACCENTS[a.accent];
  if (a.accent === 'custom' && HEX.test(a.custom || '')) {
    accent = a.custom;
    g = HEX.test(a.custom2 || '')
      ? [a.custom, mixHex(a.custom, a.custom2, 0.5), a.custom2] // your own gradient
      : [shade(accent, 0.35), accent, shade(accent, -0.35)];
  } else {
    const q = p || ACCENTS.ember;
    g = q.g;
    accent = q.a;
  }
  const f = { muted: 0.55, vivid: 1.35 }[a.strength] || 1;
  if (f !== 1) {
    g = g.map((c) => saturate(c, f));
    accent = saturate(accent, f);
  }
  const t = THEMES[theme] || THEMES[DEFAULT_THEME];
  const light = !!t.light;
  // Very pale gradients on a light theme, and very dark ones on a dark theme,
  // vanish into the background: move them towards something visible.
  if (light && luminance(g[1]) > 0.6) g = g.map((c) => shade(c, -0.5));
  else if (!light && luminance(g[1]) < 0.07) g = g.map((c) => (luminance(c) < 0.07 ? shade(c, 0.45) : c));
  // The solid accent (text, outlines, switches) must stand out clearly from the
  // panels: at least 3.2 : 1. Darken it on light themes, lighten it on dark ones.
  const ratio = (x, y) => { const [p, q] = [luminance(x), luminance(y)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
  for (let i = 0; i < 12 && ratio(accent, t.panel) < 3.2; i++) accent = shade(accent, light ? -0.1 : 0.12);
  // On light themes, pale gradient stops (used for headings and glows) get a little darker too.
  if (light) g = g.map((c) => { let x = c; for (let i = 0; i < 10 && ratio(x, t.panel) < 2.2; i++) x = shade(x, -0.1); return x; });
  return { g, accent };
}

const DEFAULT_THEME = 'graphite';

const TINTED = ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3', '--pop', '--modal', '--toast'];

function applyAppearance(a) {
  const root = document.documentElement;
  const theme = THEMES[a.theme] ? a.theme : DEFAULT_THEME;
  root.dataset.theme = theme;
  root.dataset.tone = THEMES[theme].light ? 'light' : 'dark';
  applyEyes(a);
  root.dataset.motion = a.motion || 'full';
  root.dataset.density = a.density || 'comfortable';
  root.dataset.aurora = a.aurora === false ? 'off' : 'on';

  const { g, accent } = lookColours(a, theme);
  root.style.setProperty('--g1', g[0]);
  root.style.setProperty('--g2', g[1]);
  root.style.setProperty('--g3', g[2]);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--on-accent', luminance(g[1]) > 0.55 ? '#111' : '#fff');
  root.style.setProperty('--r', { round: 1, soft: 0.6, sharp: 0.25 }[a.radius] ?? 1);
  root.style.setProperty('--card-min', `${Math.max(160, Math.min(380, Number(a.cardSize) || 230))}px`);
  const motion = a.motion || 'full';
  root.style.setProperty('--lift', motion === 'full' ? '-3px' : motion === 'subtle' ? '-1px' : '0px');
  root.style.setProperty('--grow', motion === 'full' ? '1.035' : motion === 'subtle' ? '1.01' : '1');

  // Tinted backgrounds: the theme's own colours with a little of the accent mixed in.
  for (const k of TINTED) root.style.removeProperty(k);
  const t = THEMES[theme];
  let bar = t.bg;
  if (a.tint) {
    const amt = t.light ? 0.06 : 0.08;
    const cs = getComputedStyle(root);
    for (const k of TINTED) {
      const v = cs.getPropertyValue(k).trim();
      if (HEX.test(v)) root.style.setProperty(k, mixHex(v, accent, amt));
    }
    bar = mixHex(t.bg, accent, amt);
  }
  api.titlebar({ color: bar, symbol: t.text });
}

async function setAppearance(patch, { rerender = true } = {}) {
  S.settings.appearance = { ...S.settings.appearance, ...patch };
  applyAppearance(S.settings.appearance);
  if ('zoom' in patch) api.zoom(patch.zoom);
  api.setSettings({ appearance: patch });
  if (rerender && S.page === 'settings') renderSettings();
}

// ---------- Eyes & reading ----------
// Options so the app suits everyone's eyes: size, contrast, easy-read fonts,
// text spacing, colour-blind friendly status colours, a warm screen, and
// strong keyboard outlines. Each one is a data-* switch on <html> that
// eyes.css reads, so nothing else needs to know about them.

const EYE_DEFAULTS = {
  zoom: 1, contrast: 'normal', font: 'default', textSpacing: false, boldText: false,
  vision: 'standard', warm: 'off', strongFocus: false, underlineLinks: false, solid: false,
};

const EYE_FONTS = [
  ['default', 'Standard'],
  ['clear', 'Clear'],
  ['wide', 'Wide'],
  ['friendly', 'Friendly'],
];

// One-click starting points. Each sets every eye option, so they don't mix.
const EYE_PRESETS = [
  ['standard', 'Standard', 'The normal look.', {}],
  ['easy', 'Easy reading', 'Wider letters, more space between lines.', { font: 'wide', textSpacing: true, zoom: 1.1 }],
  ['big', 'Big & bold', 'Everything larger, thicker text.', { zoom: 1.35, boldText: true, contrast: 'high', strongFocus: true }],
  ['contrast', 'High contrast', 'Brightest text, solid panels, clear outlines.', { contrast: 'high', solid: true, strongFocus: true, underlineLinks: true }],
  ['gentle', 'Gentle', 'Softer text and a warm screen, for long sessions or the evening.', { contrast: 'soft', warm: 'low' }],
];

function applyEyes(a) {
  const root = document.documentElement;
  const v = (k) => (a[k] === undefined ? EYE_DEFAULTS[k] : a[k]);
  root.dataset.contrast = v('contrast');
  root.dataset.font = v('font');
  root.dataset.spacing = v('textSpacing') ? 'on' : 'off';
  root.dataset.weight = v('boldText') ? 'bold' : 'normal';
  root.dataset.vision = v('vision');
  root.dataset.warm = v('warm');
  root.dataset.focus = v('strongFocus') ? 'strong' : 'normal';
  root.dataset.links = v('underlineLinks') ? 'underline' : 'plain';
  root.dataset.solid = v('solid') ? 'on' : 'off';
}

// Which preset (if any) matches the current options exactly.
function currentEyePreset(a) {
  const keys = Object.keys(EYE_DEFAULTS);
  for (const [id, , , patch] of EYE_PRESETS) {
    const want = { ...EYE_DEFAULTS, ...patch };
    if (keys.every((k) => (a[k] === undefined ? EYE_DEFAULTS[k] : a[k]) === want[k])) return id;
  }
  return null;
}

// The "Eyes & reading" card on the Settings page.
function eyesCard(appName) {
  const ap = S.settings.appearance;
  const val = (k) => (ap[k] === undefined ? EYE_DEFAULTS[k] : ap[k]);
  const now = currentEyePreset(ap);
  const row = (label, hint, control) => h('div', { class: 'set-row' },
    h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), hint ? h('div', { class: 'set-hint' }, hint) : null), control);

  const presets = h('div', { class: 'eye-presets' }, EYE_PRESETS.map(([id, name, text, patch]) => h('button', {
    class: `eye-preset ${now === id ? 'on' : ''}`,
    onclick: () => setAppearance({ ...EYE_DEFAULTS, ...patch }),
  }, h('b', null, name), h('span', null, text), now === id ? ic('check', 14, 'eye-check') : null)));

  // Size: a slider, applied live while dragging, saved when let go.
  const pct = h('span', { class: 'eye-pct' }, `${Math.round(val('zoom') * 100)}%`);
  const size = h('input', { type: 'range', class: 'eye-range', min: '0.8', max: '1.75', step: '0.05', value: String(val('zoom')), 'aria-label': 'Text and interface size' });
  size.addEventListener('input', () => { pct.textContent = `${Math.round(Number(size.value) * 100)}%`; });
  size.addEventListener('change', () => setAppearance({ zoom: Number(size.value) }));
  const sizeRow = h('div', { class: 'set-block' },
    h('div', { class: 'eye-size-head' }, h('div', { class: 'set-label' }, 'Text & interface size'), pct),
    h('div', { class: 'set-hint' }, 'Makes everything bigger or smaller: text, buttons and icons. You can also hold Ctrl and press + or −.'),
    h('div', { class: 'eye-size' }, h('span', { class: 'eye-a small' }, 'A'), size, h('span', { class: 'eye-a big' }, 'A')));

  const fontPick = h('div', { class: 'eye-fonts' }, EYE_FONTS.map(([id, name]) => h('button', {
    class: `eye-font ${val('font') === id ? 'on' : ''}`,
    'data-sample': id,
    onclick: () => setAppearance({ font: id }),
  }, h('span', { class: 'eye-font-aa' }, 'Aa'), h('span', null, name))));

  return h('div', { class: 'card eyes-card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Eyes & reading'), h('p', { class: 'card-sub' }, `Make ${appName} easy to read for your eyes.`)), ic('eye', 20, 'card-head-icon')),
    h('div', { class: 'set-block' }, h('div', { class: 'set-label' }, 'Quick start'), presets),
    sizeRow,
    row('Contrast', 'High makes text and edges brighter. Soft is easier on sensitive eyes.',
      seg([['soft', 'Soft'], ['normal', 'Normal'], ['high', 'High']], val('contrast'), (v) => setAppearance({ contrast: v }))),
    h('div', { class: 'set-block' },
      h('div', { class: 'set-label' }, 'Font'),
      h('div', { class: 'set-hint' }, 'Clear is plain and simple. Wide has bigger, more open letters. Friendly is rounded and loose, which many people with dyslexia find easier.'),
      fontPick),
    row('Colour vision', 'Done, warning and error colours that stay easy to tell apart. Every state also has its own word and icon.',
      seg([['standard', 'Standard'], ['redgreen', 'Red–green safe'], ['blueyellow', 'Blue–yellow safe']], val('vision'), (v) => setAppearance({ vision: v }))),
    row('Warm screen', 'Adds a warm tint, like Night light, to cut blue light.',
      seg([['off', 'Off'], ['low', 'Low'], ['high', 'High']], val('warm'), (v) => setAppearance({ warm: v }))),
    h('div', { class: 'options' },
      toggle({ iconName: 'layers', label: 'More space between letters and lines', checked: val('textSpacing'), onChange: (v) => setAppearance({ textSpacing: v }) }),
      toggle({ iconName: 'pencil', label: 'Thicker text', checked: val('boldText'), onChange: (v) => setAppearance({ boldText: v }) }),
      toggle({ iconName: 'grid', label: 'Solid panels', hint: 'No see-through or blurred backgrounds.', checked: val('solid'), onChange: (v) => setAppearance({ solid: v }) }),
      toggle({ iconName: 'sparkles', label: 'Bold outline on the selected button', hint: 'Easier to follow when using Tab and the keyboard.', checked: val('strongFocus'), onChange: (v) => setAppearance({ strongFocus: v }) }),
      toggle({ iconName: 'link', label: 'Underline links', checked: val('underlineLinks'), onChange: (v) => setAppearance({ underlineLinks: v }) })),
    h('div', { class: 'card-foot' }, btn('Reset eye options', { kind: 'ghost sm', icon: 'retry', onClick: () => setAppearance({ ...EYE_DEFAULTS }) })));
}

// Ctrl + / Ctrl − / Ctrl 0 change the size (main window only).
{
  document.addEventListener('keydown', (e) => {
    // Only in the main window (the Capture window has no settings of its own).
    if (typeof renderSettings !== 'function' || typeof S === 'undefined' || !S.settings) return;
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const z = Number(S.settings && S.settings.appearance && S.settings.appearance.zoom) || 1;
    let next = null;
    if (e.key === '=' || e.key === '+') next = z + 0.05;
    else if (e.key === '-' || e.key === '_') next = z - 0.05;
    else if (e.key === '0') next = 1;
    if (next === null) return;
    e.preventDefault();
    next = Math.round(Math.max(0.8, Math.min(1.75, next)) * 100) / 100;
    if (next !== z) setAppearance({ zoom: next });
  });
}

// The size choice in first-run setup, so nobody has to squint through it.
function setupEyes(redraw) {
  const z = Number(S.settings.appearance.zoom) || 1;
  return h('div', { class: 'setup-eyes' },
    h('div', { class: 'setup-eyes-row' }, h('span', { class: 'set-label' }, 'Text size'),
      seg([[1, '100%'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']], [1, 1.15, 1.3, 1.5].includes(z) ? z : '', (v) => { setAppearance({ zoom: v }, { rerender: false }); redraw(); })),
    h('p', { class: 'fine' }, ic('eye', 13), ' More for your eyes — contrast, easy-read fonts, colour-blind friendly colours — in Settings › Eyes & reading.'));
}

// ---------- more colour options (Settings › Appearance) ----------
function accentName(a) {
  if (a.accent === 'custom') return HEX.test(a.custom2 || '') ? 'Your own gradient' : 'Your own colour';
  return (ACCENTS[a.accent] || ACCENTS.ember).name;
}

function colourExtras() {
  const ap = S.settings.appearance;
  const row = (label, hint, control) => h('div', { class: 'set-row' },
    h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), hint ? h('div', { class: 'set-hint' }, hint) : null), control);

  // Your own gradient: two colours, blended in the middle.
  // The pickers start from the colours in use now, so the bar between them matches.
  const own = ap.accent === 'custom' && HEX.test(ap.custom || '') && HEX.test(ap.custom2 || '');
  const nowG = (ACCENTS[ap.accent] || {}).g || lookColours(ap, THEMES[ap.theme] ? ap.theme : DEFAULT_THEME).g;
  const from = h('input', { type: 'color', value: own ? ap.custom : nowG[0], 'aria-label': 'Gradient start colour' });
  const to = h('input', { type: 'color', value: own ? ap.custom2 : nowG[2], 'aria-label': 'Gradient end colour' });
  const useGrad = (rerender) => setAppearance({ accent: 'custom', custom: from.value, custom2: to.value }, { rerender });
  for (const el of [from, to]) {
    el.addEventListener('input', () => useGrad(false));
    el.addEventListener('change', () => useGrad(true));
  }
  const gradRow = h('div', { class: 'set-block' },
    h('div', { class: 'set-label' }, 'Your own gradient'),
    h('div', { class: 'set-hint' }, 'Pick a start and an end colour. Buttons, glows and highlights blend between them.'),
    h('div', { class: 'grad-row' },
      h('label', { class: 'grad-pick' }, from, 'Start'),
      h('div', { class: 'grad-preview', title: 'How it looks' }),
      h('label', { class: 'grad-pick' }, to, 'End')));

  return h('div', { class: 'colour-extras' },
    h('div', { class: 'set-hint' }, 'Now using:', h('span', { class: 'accent-now' }, accentName(ap)), ' ',
      h('button', {
        class: 'link',
        onclick: () => {
          const ids = Object.keys(ACCENTS).filter((id) => id !== ap.accent);
          setAppearance({ accent: ids[Math.floor(Math.random() * ids.length)] });
        },
      }, 'Shuffle')),
    gradRow,
    row('Colour strength', 'Muted is calmer and easier on the eyes. Vivid is brighter and bolder.',
      seg([['muted', 'Muted'], ['normal', 'Normal'], ['vivid', 'Vivid']], ap.strength || 'normal', (v) => setAppearance({ strength: v }))),
    h('div', { class: 'options' },
      toggle({ iconName: 'palette', label: 'Tinted backgrounds', hint: 'Panels and backgrounds pick up a hint of your accent colour.', checked: !!ap.tint, onChange: (v) => setAppearance({ tint: v }) })));
}
