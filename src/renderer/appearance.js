'use strict';
// Look & feel: theme, accent colour, motion, corners, density, size.

const ACCENTS = {
  ember: { name: 'Ember', g: ['#ffb04a', '#ff4f73', '#9b5cff'], a: '#ff5e62' },
  ocean: { name: 'Ocean', g: ['#5ee7ff', '#3b82f6', '#6d5cff'], a: '#3b9bff' },
  violet: { name: 'Violet', g: ['#f0abfc', '#a855f7', '#6366f1'], a: '#a855f7' },
  mint: { name: 'Mint', g: ['#bbf7d0', '#34d399', '#0ea5e9'], a: '#2ecf95' },
  gold: { name: 'Gold', g: ['#fde68a', '#f59e0b', '#ef4444'], a: '#f5a524' },
  crimson: { name: 'Crimson', g: ['#ffa8a8', '#ef4444', '#be123c'], a: '#f43f5e' },
  mono: { name: 'Mono', g: ['#ffffff', '#c7cbd6', '#7c8394'], a: '#d6d9e0' },
};

const THEMES = {
  graphite: { name: 'Graphite', bg: '#0b0c10', panel: '#14161c', text: '#a3a9b8' },
  midnight: { name: 'Midnight', bg: '#000000', panel: '#0d0d11', text: '#a3a9b8' },
  ocean: { name: 'Deep blue', bg: '#060a14', panel: '#0f182c', text: '#a3b1cc' },
  light: { name: 'Light', bg: '#e4e7ee', panel: '#ffffff', text: '#4a5164' },
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

function applyAppearance(a) {
  const root = document.documentElement;
  const theme = THEMES[a.theme] ? a.theme : 'graphite';
  root.dataset.theme = theme;
  root.dataset.motion = a.motion || 'full';
  root.dataset.density = a.density || 'comfortable';
  root.dataset.aurora = a.aurora === false ? 'off' : 'on';

  let g;
  let accent;
  if (a.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(a.custom || '')) {
    accent = a.custom;
    g = [shade(accent, 0.35), accent, shade(accent, -0.35)];
  } else {
    const p = ACCENTS[a.accent] || ACCENTS.ember;
    g = p.g;
    accent = p.a;
  }
  // Mono on a light background needs to be dark to be seen.
  if (theme === 'light' && luminance(accent) > 0.6) {
    accent = shade(accent, -0.55);
    g = g.map((c) => shade(c, -0.5));
  }
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

  const t = THEMES[theme];
  api.titlebar({ color: t.bg, symbol: t.text });
}

async function setAppearance(patch, { rerender = true } = {}) {
  S.settings.appearance = { ...S.settings.appearance, ...patch };
  applyAppearance(S.settings.appearance);
  if ('zoom' in patch) api.zoom(patch.zoom);
  api.setSettings({ appearance: patch });
  if (rerender && S.page === 'settings') renderSettings();
}
