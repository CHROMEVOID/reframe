'use strict';
// Small DOM helpers and shared components: toasts, modals, menus, popovers.
const api = window.reframe;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ic = (name, size, cls) => {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size, cls);
  return t.content.firstChild;
};

function btn(label, { icon: iconName, kind = '', onClick, title, disabled, size = '' } = {}) {
  return h('button', {
    class: `btn ${kind} ${size} ${label ? '' : 'icon-only'}`.trim(),
    onclick: onClick,
    title: title || (label ? null : undefined),
    'aria-label': label ? null : title,
    disabled: !!disabled,
  }, iconName ? ic(iconName, size === 'lg' ? 20 : 17) : null, label ? h('span', null, label) : null);
}

// ---------- formatting ----------
function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${u[i]}`;
}

function fmtDuration(sec) {
  if (!sec || !isFinite(sec)) return '';
  sec = Math.round(sec);
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

function fmtEta(sec) {
  if (!sec || !isFinite(sec) || sec < 1) return '';
  if (sec < 60) return 'Less than a minute left';
  const m = Math.round(sec / 60);
  if (m < 60) return `About ${m} min left`;
  const hh = Math.floor(m / 60);
  return `About ${hh} h ${m % 60} min left`;
}

function fmtElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

const plural = (n, word, many) => `${n.toLocaleString()} ${n === 1 ? word : (many || `${word}s`)}`;
const splitPath = (p) => {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i < 0 ? ['', p] : [p.slice(0, i), p.slice(i + 1)];
};
const baseName = (p) => splitPath(p.replace(/[\\/]+$/, ''))[1] || p;

function mediaUrl(p) {
  const bytes = new TextEncoder().encode(p);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return `reframe://app/@media/${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
const thumbUrl = (v) => `reframe://app/@thumb/${encodeURIComponent(v.thumb)}?t=${v.thumbAt || 0}`;

// ---------- toasts ----------
function toast(message, { kind = 'info', action, timeout = 4200 } = {}) {
  const iconName = { info: 'info', ok: 'check', error: 'alert', warn: 'alert' }[kind] || 'info';
  const el = h('div', { class: `toast ${kind}` },
    h('span', { class: 'toast-icon' }, ic(iconName, 18)),
    h('div', { class: 'toast-msg' }, message),
    action ? h('button', {
      class: 'toast-action',
      onclick: () => {
        action.run();
        close();
      },
    }, action.label) : null,
    h('button', { class: 'toast-x', onclick: () => close(), 'aria-label': 'Dismiss' }, ic('x', 15)));
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  };
  $('#toasts').append(el);
  if (timeout) setTimeout(close, timeout);
  return close;
}

// ---------- modal ----------
function modal({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const layer = $('#layer');
  const prevFocus = document.activeElement;
  const box = h('div', { class: `modal ${wide ? 'wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true' });
  const veil = h('div', { class: 'veil' }, box);
  const close = (value) => {
    veil.classList.add('leaving');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => veil.remove(), 160);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose(value);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(null);
    }
  };
  document.addEventListener('keydown', onKey, true);
  veil.addEventListener('mousedown', (e) => {
    if (e.target === veil) close(null);
  });
  if (title) box.append(h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'btn ghost icon-only', onclick: () => close(null), 'aria-label': 'Close' }, ic('x', 18))));
  const content = h('div', { class: 'modal-body' });
  append(content, [typeof body === 'function' ? body(close) : body]);
  box.append(content);
  if (actions.length) {
    box.append(h('div', { class: 'modal-foot' }, actions.map((a) => {
      const b = btn(a.label, { kind: a.kind || '', icon: a.icon, onClick: () => (a.run ? a.run(close) : close(a.value)) });
      if (a.autofocus) setTimeout(() => b.focus(), 30);
      return b;
    })));
  }
  layer.append(veil);
  return close;
}

function confirmBox({ title, message, confirm = 'OK', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', { class: 'modal-text' }, message),
      actions: [
        { label: 'Cancel', kind: 'ghost', value: false },
        { label: confirm, kind: danger ? 'danger' : 'primary', value: true, autofocus: true },
      ],
      onClose: (v) => resolve(!!v),
    });
  });
}

function promptBox({ title, label, value = '', placeholder = '', confirm = 'Save' }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, placeholder, spellcheck: 'false' });
    let closeFn;
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
      }
      resolve(v);
      resolved = true;
      closeFn(v);
    };
    let resolved = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    closeFn = modal({
      title,
      body: h('label', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, input),
      actions: [
        { label: 'Cancel', kind: 'ghost', value: null },
        { label: confirm, kind: 'primary', run: submit },
      ],
      onClose: () => {
        if (!resolved) resolve(null);
      },
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 40);
  });
}

// ---------- context menu / popover ----------
let openMenuClose = null;

function closeMenus() {
  if (openMenuClose) openMenuClose();
}

function positionFloating(el, { x, y, anchor, align = 'start' }) {
  el.style.visibility = 'hidden';
  document.body.append(el);
  const r = el.getBoundingClientRect();
  let left;
  let top;
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    left = align === 'end' ? a.right - r.width : a.left;
    top = a.bottom + 6;
    if (top + r.height > innerHeight - 8) top = Math.max(8, a.top - r.height - 6);
  } else {
    left = x;
    top = y;
    if (top + r.height > innerHeight - 8) top = Math.max(8, y - r.height);
  }
  if (left + r.width > innerWidth - 8) left = innerWidth - r.width - 8;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
  el.style.visibility = '';
}

function showMenu(items, pos) {
  closeMenus();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') {
      menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (it.header) {
      menu.append(h('div', { class: 'menu-header' }, it.header));
      continue;
    }
    menu.append(h('button', {
      class: `menu-item ${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`,
      role: 'menuitem',
      disabled: !!it.disabled,
      onclick: (e) => {
        e.stopPropagation();
        close();
        it.run();
      },
    },
    it.swatch ? h('i', { class: 'swatch', style: { background: it.swatch } }) : (it.icon ? ic(it.icon, 16) : h('i', { class: 'menu-pad' })),
    h('span', null, it.label),
    it.checked ? ic('check', 15, 'menu-check') : (it.hint ? h('kbd', null, it.hint) : null)));
  }
  const onDown = (e) => {
    if (!menu.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    menu.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (openMenuClose === close) openMenuClose = null;
  };
  positionFloating(menu, pos);
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  });
  openMenuClose = close;
  return close;
}

function popover(content, anchor, { className = '', align = 'start' } = {}) {
  closeMenus();
  const el = h('div', { class: `popover ${className}` }, content);
  const onDown = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target)) close();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    el.remove();
    anchor.classList.remove('open');
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openMenuClose === close) openMenuClose = null;
  };
  positionFloating(el, { anchor, align });
  anchor.classList.add('open');
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  });
  openMenuClose = close;
  return close;
}

function toggle({ checked, onChange, label, hint, iconName, disabled }) {
  const input = h('input', { type: 'checkbox', class: 'switch-input', disabled: !!disabled });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: `option ${disabled ? 'disabled' : ''}` },
    iconName ? h('span', { class: 'option-icon' }, ic(iconName, 18)) : null,
    h('span', { class: 'option-text' }, h('span', { class: 'option-label' }, label), hint ? h('span', { class: 'option-hint' }, hint) : null),
    input,
    h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

function emptyState({ iconName, title, text, actions = [] }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-art' }, ic(iconName, 30)),
    h('h3', null, title),
    text ? h('p', null, text) : null,
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}
