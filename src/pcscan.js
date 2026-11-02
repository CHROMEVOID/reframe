'use strict';
// Finds the videos on this PC: the user's own folders on C: and every other
// drive, skipping Windows, programs, games and app data.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { isVideo } = require('./engine');

const SKIP = new Set([
  'windows', 'program files', 'program files (x86)', 'programdata', 'appdata', '$recycle.bin',
  'system volume information', 'recovery', 'perflogs', 'msocache', '$windows.~bt', '$windows.~ws',
  '$winreagent', 'windowsapps', 'node_modules', '.git', '.cache', '.vscode', '.npm', 'site-packages',
  'steamapps', 'steamlibrary', 'steam', 'epic games', 'riot games', 'xboxgames', 'origin games',
  'ea games', 'ubisoft game launcher', 'gog games', 'battle.net', 'config.msi', 'intel', 'amd', 'nvidia',
  'drivers', '$sysreset', 'onedrivetemp',
]);
const MIN_BYTES = 500 * 1024; // skips UI sounds, tiny clips and TypeScript ".ts" files

function defaultRoots(drives) {
  const home = os.homedir();
  const roots = [];
  const add = (p, label) => {
    if (p && fs.existsSync(p) && !roots.some((r) => r.path.toLowerCase() === p.toLowerCase())) roots.push({ path: p, label });
  };
  add(path.join(home, 'Videos'), 'Videos');
  add(path.join(home, 'Downloads'), 'Downloads');
  add(path.join(home, 'Desktop'), 'Desktop');
  add(path.join(home, 'Documents'), 'Documents');
  add(path.join(home, 'Pictures'), 'Pictures');
  add(process.env.OneDrive, 'OneDrive');
  const sys = (process.env.SystemDrive || 'C:').toUpperCase();
  for (const d of drives || []) {
    if (d.kind === 'network' || d.letter.toUpperCase() === sys) continue;
    add(d.root, `${d.letter} ${d.label || (d.kind === 'removable' ? 'USB drive' : 'Drive')}`.trim());
  }
  return roots;
}

// Walks every root. onProgress gets {folders, found, current}.
async function scanPc(roots, { onProgress, shouldStop, exclude = [] } = {}) {
  const seen = new Set(exclude.map((p) => path.resolve(p).toLowerCase()));
  const results = [];
  const stats = { folders: 0, found: 0, current: '' };
  let last = 0;
  const tick = (force) => {
    const now = Date.now();
    if (onProgress && (force || now - last > 120)) {
      last = now;
      onProgress({ ...stats });
    }
  };

  for (const root of roots) {
    const files = [];
    const stack = [root.path];
    while (stack.length) {
      if (shouldStop && shouldStop()) return { results, stats, stopped: true };
      const dir = stack.pop();
      const key = dir.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      stats.folders++;
      stats.current = dir;
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          const n = e.name.toLowerCase();
          if (SKIP.has(n) || n.startsWith('.') || n.startsWith('$')) continue;
          stack.push(abs);
        } else if (e.isFile() && isVideo(e.name)) {
          try {
            const st = await fsp.stat(abs);
            if (st.size < MIN_BYTES) continue;
            files.push({ abs, rel: path.relative(root.path, abs), size: st.size, mtime: st.mtimeMs });
            stats.found++;
          } catch { /* unreadable */ }
        }
      }
      tick();
    }
    if (files.length) results.push({ root: root.path, label: root.label, files });
  }
  tick(true);
  return { results, stats, stopped: false };
}

module.exports = { defaultRoots, scanPc };
