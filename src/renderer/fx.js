'use strict';
// Motion effects: cursor spotlight, 3D tilt, ripples, confetti, count-ups
// and scroll reveals.

const motionOn = () => document.documentElement.dataset.motion !== 'off';
const motionFull = () => document.documentElement.dataset.motion === 'full';

// Spotlight + tilt follow the cursor on anything marked .spot / .tilt / .glow-track.
// Work happens at most once per frame, however fast the mouse moves.
let lastMove = null;
document.addEventListener('pointermove', (e) => {
  if (!lastMove) requestAnimationFrame(() => {
    const ev = lastMove;
    lastMove = null;
    followCursor(ev);
  });
  lastMove = e;
}, { passive: true });
function followCursor(e) {
  const el = e.target.closest && e.target.closest('.spot, .tilt, .glow-track');
  if (!el || !motionOn()) return;
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  el.style.setProperty('--mx', `${x}px`);
  el.style.setProperty('--my', `${y}px`);
  if (el.classList.contains('tilt') && motionFull()) {
    const rx = ((y / r.height) - 0.5) * -6;
    const ry = ((x / r.width) - 0.5) * 8;
    el.style.setProperty('--rx', `${rx}deg`);
    el.style.setProperty('--ry', `${ry}deg`);
  }
}
document.addEventListener('pointerout', (e) => {
  const el = e.target.closest && e.target.closest('.tilt');
  if (el && !el.contains(e.relatedTarget)) {
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }
}, { passive: true });

// Click ripple on buttons.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('.btn, .nav-item, .seg button, .chip-btn');
  if (!b || !motionOn() || b.disabled) return;
  const r = b.getBoundingClientRect();
  const s = Math.max(r.width, r.height) * 2;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  dot.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.append(dot);
  setTimeout(() => dot.remove(), 600);
}, { passive: true });

// Numbers that count up when they first appear.
function countUp(el, to, { format = (n) => Math.round(n).toLocaleString(), ms = 700 } = {}) {
  if (!motionOn() || !isFinite(to)) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(to * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Children fade up one after another.
function stagger(container, selector = ':scope > *') {
  if (!motionOn()) return;
  container.querySelectorAll(selector).forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 14));
    el.classList.add('rise');
  });
}

// A short burst of confetti when a folder finishes.
function confetti() {
  if (!motionFull()) return;
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const css = getComputedStyle(document.documentElement);
  const colors = ['--g1', '--g2', '--g3', '--ok'].map((v) => css.getPropertyValue(v).trim() || '#fff');
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 200,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    s: 4 + Math.random() * 6,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  c.classList.add('on');
  const t0 = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (t - t0 < 2600) requestAnimationFrame(frame);
    else {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      c.classList.remove('on');
    }
  };
  requestAnimationFrame(frame);
}

// Cards slide in as they scroll into view, and a light follows the cursor over them.
(() => {
  // Big grids (library, site lists) have their own entrance animation, so they're left out.
  const CARDS = '.card, .stat, .server-card, .src-tile, .job, .home-tile';
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      e.target.classList.add('seen');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -20px 0px' });
  const watch = (root) => {
    if (!motionOn() || root.closest('#page-library')) return;
    const els = root.matches(CARDS) ? [root] : [...root.querySelectorAll(CARDS)];
    if (els.length > 80) return;
    els.forEach((el) => {
      if (el.dataset.rv) return;
      el.dataset.rv = 1;
      el.classList.add('glow-track');
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) return; // already on screen: don't hide it
      el.classList.add('reveal');
      io.observe(el);
    });
  };
  // New cards are checked once per frame, in one go.
  let pending = [];
  new MutationObserver((ms) => {
    if (!pending.length) requestAnimationFrame(() => {
      const nodes = pending;
      pending = [];
      for (const n of nodes) if (n.isConnected) watch(n);
    });
    for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) pending.push(n);
  }).observe(document.body, { childList: true, subtree: true });
})();
