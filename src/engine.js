'use strict';
// Scans a folder tree, plans a mirrored output tree and drives HandBrakeCLI.
// Originals are only ever read: nothing in the source folder is written,
// moved or deleted.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const VIDEO_EXTS = new Set([
  'mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'f4v', 'webm', 'mpg', 'mpeg', 'mpe',
  'm2ts', 'mts', 'ts', 'm2t', 'vob', '3gp', '3g2', 'ogv', 'divx', 'xvid', 'asf', 'rm',
  'rmvb', 'dv', 'mxf', 'qt', 'wtv', 'dvr-ms',
]);
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information']);
const SKIP_FILES = /^(desktop\.ini|thumbs\.db|\.ds_store)$/i;
const PARTIAL_TAG = '.reframe-partial';

const isVideo = (name) => VIDEO_EXTS.has(path.extname(name).slice(1).toLowerCase());
const keyOf = (p) => path.resolve(p).toLowerCase();
const naturalSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function scanFolder(root, { exclude = [] } = {}) {
  root = path.resolve(root);
  const excluded = new Set(exclude.filter(Boolean).map(keyOf));
  const tree = { name: path.basename(root) || root, rel: '', dirs: [], videos: [], others: [] };
  const totals = { videos: 0, videoBytes: 0, others: 0, otherBytes: 0, dirs: 0, errors: [] };

  async function walk(abs, node) {
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (e) {
      totals.errors.push({ path: abs, message: e.message });
      return;
    }
    entries.sort(naturalSort);
    for (const ent of entries) {
      const childAbs = path.join(abs, ent.name);
      const rel = node.rel ? path.join(node.rel, ent.name) : ent.name;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase()) || excluded.has(keyOf(childAbs))) continue;
        const child = { name: ent.name, rel, dirs: [], videos: [], others: [] };
        node.dirs.push(child);
        totals.dirs++;
        await walk(childAbs, child);
      } else if (ent.isFile()) {
        if (SKIP_FILES.test(ent.name) || ent.name.includes(PARTIAL_TAG)) continue;
        let size = 0;
        try {
          size = (await fsp.stat(childAbs)).size;
        } catch { /* unreadable files still get listed */ }
        if (isVideo(ent.name)) {
          node.videos.push({ name: ent.name, rel, size });
          totals.videos++;
          totals.videoBytes += size;
        } else {
          node.others.push({ name: ent.name, rel, size });
          totals.others++;
          totals.otherBytes += size;
        }
      }
    }
  }

  await walk(root, tree);

  const count = (node) => {
    node.totalVideos = node.videos.length + node.dirs.reduce((n, d) => n + count(d), 0);
    return node.totalVideos;
  };
  count(tree);
  return { root, tree, totals };
}

function defaultDestination(root, suffix = ' converted') {
  root = path.resolve(root);
  const base = path.basename(root);
  if (!base) {
    // A whole drive was chosen, e.g. "E:\" -> "E:\E drive converted"
    const letter = root.replace(/[:\\/]/g, '') || 'Drive';
    return path.join(root, `${letter} drive${suffix}`);
  }
  return path.join(path.dirname(root), base + suffix);
}

// Works out the output path of every video so that each one lands in the
// same relative folder it came from. Two sources that would end up with the
// same name (clip.avi + clip.mov -> clip.mp4) get the old extension added.
function planOutputs(tree, ext) {
  const items = [];
  const dirs = [];
  const others = [];
  const visit = (node) => {
    if (node.rel) dirs.push(node.rel);
    const taken = new Set(node.others.map((o) => o.name.toLowerCase()));
    const ordered = [...node.videos].sort((a, b) => {
      const am = path.extname(a.name).toLowerCase() === ext ? 0 : 1;
      const bm = path.extname(b.name).toLowerCase() === ext ? 0 : 1;
      return am - bm || naturalSort(a, b);
    });
    for (const v of ordered) {
      const p = path.parse(v.name);
      let outName = p.name + ext;
      if (taken.has(outName.toLowerCase())) {
        const tag = p.ext.slice(1) || 'video';
        outName = `${p.name} (${tag})${ext}`;
        for (let n = 2; taken.has(outName.toLowerCase()); n++) outName = `${p.name} (${tag} ${n})${ext}`;
      }
      taken.add(outName.toLowerCase());
      items.push({ src: v.rel, out: path.join(path.dirname(v.rel), outName), size: v.size });
    }
    for (const o of node.others) others.push({ src: o.rel, size: o.size });
    node.dirs.forEach(visit);
  };
  visit(tree);
  // Keep the run order the same as the folder order the user sees.
  const order = new Map();
  const walkOrder = (node) => {
    node.videos.forEach((v) => order.set(v.rel, order.size));
    node.dirs.forEach(walkOrder);
  };
  walkOrder(tree);
  items.sort((a, b) => order.get(a.src) - order.get(b.src));
  return { items, dirs, others };
}

const PROGRESS_RE = /Encoding: task (\d+) of (\d+), ([\d.]+) %(?: \(([\d.]+) fps, avg ([\d.]+) fps, ETA (\d+)h(\d+)m(\d+)s\))?/;

function explainFailure(lines, code) {
  const text = lines.join('\n');
  if (/No title found/i.test(text)) return 'HandBrake could not read this file. It may be damaged or not a real video.';
  if (/Invalid preset|preset .* not found|Unable to find preset/i.test(text)) return 'HandBrake did not recognise the selected preset.';
  if (/No space left|ENOSPC|disk full/i.test(text)) return 'The destination drive is full.';
  if (/Permission denied|Access is denied/i.test(text)) return 'Windows denied access to the file or folder.';
  const err = [...lines].reverse().find((l) => /error|failed|invalid/i.test(l));
  if (err) return err.replace(/^\[\d\d:\d\d:\d\d\]\s*/, '').trim();
  return `HandBrake stopped unexpectedly (exit code ${code}).`;
}

// How many videos to encode at once. HandBrake can't keep every core busy on
// small videos, so running a few side by side finishes a folder much sooner
// with exactly the same quality. 0 means "work it out".
function parallelFor(job, setting) {
  if (setting > 0) return Math.min(4, setting);
  const cores = os.cpus().length || 4;
  if (job.gpuEncoder) return 2;
  const h = job.preset.height || 1080;
  if (h <= 600) return Math.max(1, Math.min(4, Math.floor(cores / 3)));
  if (h <= 1100) return cores >= 8 ? 2 : 1;
  return 1;
}

// Picks the graphics-card encoder that matches the preset's codec.
function gpuEncoderFor(presetEncoder, available) {
  const enc = String(presetEncoder || '').toLowerCase();
  if (/vce|nvenc|qsv|mf_/.test(enc)) return null; // already hardware
  const want = /265|hevc/.test(enc) ? ['h265'] : /av1/.test(enc) ? ['av1', 'h265'] : /264/.test(enc) ? ['h264'] : [];
  for (const codec of want) {
    for (const vendor of ['nvenc', 'vce', 'qsv']) {
      const name = `${vendor}_${codec}`;
      if (available.includes(name)) return name;
    }
  }
  return null;
}

// Builds a scan result for a hand-picked list of files in one folder.
function fileScan(dir, files) {
  const videos = files.map((f) => ({ name: path.basename(f.path), rel: path.basename(f.path), size: f.size || 0 }));
  return {
    root: dir,
    tree: { name: path.basename(dir), rel: '', dirs: [], videos, others: [], totalVideos: videos.length },
    totals: { videos: videos.length, videoBytes: videos.reduce((n, v) => n + v.size, 0), others: 0, otherBytes: 0, dirs: 0, errors: [] },
  };
}

let nextId = 1;
const uid = (p) => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

class Converter extends EventEmitter {
  constructor({ getCli, getSettings, getCustomPresetFile }) {
    super();
    this.getCli = getCli;
    this.getSettings = getSettings;
    this.getCustomPresetFile = getCustomPresetFile;
    this.jobs = [];
    this.running = new Map(); // item id -> child process
    this.timers = new Map();
  }

  list() {
    return this.jobs.map((j) => this.snapshot(j));
  }

  snapshot(job) {
    const { sourceKeys, ...rest } = job;
    return {
      ...rest,
      items: job.items.map(({ log, ...i }) => i),
      others: undefined,
      othersCount: job.others.length,
    };
  }

  emitJob(job, now = false) {
    if (now) {
      clearTimeout(this.timers.get(job.id));
      this.timers.delete(job.id);
      this.emit('update', this.snapshot(job));
      return;
    }
    if (this.timers.has(job.id)) return;
    this.timers.set(job.id, setTimeout(() => {
      this.timers.delete(job.id);
      this.emit('update', this.snapshot(job));
    }, 180));
  }

  async addJob({ source, dest, preset, options, scan, gpuEncoder = null, name = null }) {
    source = path.resolve(source);
    dest = path.resolve(dest);
    if (keyOf(source) === keyOf(dest)) throw new Error('The output folder cannot be the same as the original folder.');
    if (isInside(source, dest) && !isInside(dest, source)) {
      // dest is a parent of source: allowed, outputs never touch source paths
    }
    const plan = planOutputs(scan.tree, preset.ext);
    if (!plan.items.length) throw new Error('There are no videos in this folder.');
    const job = {
      id: uid('job'),
      kind: 'convert',
      name: name || scan.tree.name,
      source,
      dest,
      preset: { name: preset.name, ext: preset.ext, custom: !!preset.custom, height: preset.height || 0 },
      gpuEncoder,
      options: { ...options },
      status: 'queued',
      phase: '',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      dirs: plan.dirs,
      others: plan.others,
      copied: 0,
      totalBytes: plan.items.reduce((n, i) => n + i.size, 0),
      sourceKeys: new Set(plan.items.map((i) => keyOf(path.join(source, i.src)))),
      items: plan.items.map((i) => ({
        id: uid('it'),
        src: i.src,
        out: i.out,
        size: i.size,
        status: 'queued',
        progress: 0,
        fps: 0,
        eta: 0,
        outSize: 0,
        error: '',
        startedAt: null,
        finishedAt: null,
        log: [],
      })),
    };
    this.jobs.push(job);
    this.emitJob(job, true);
    this.pump();
    return job.id;
  }

  activeJob() {
    return this.jobs.find((j) => j.status === 'running' || j.status === 'preparing');
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      let job = this.activeJob();
      if (!job) {
        job = this.jobs.find((j) => j.status === 'queued');
        if (!job) {
          this.emit('idle');
          return;
        }
        await this.prepare(job);
        if (job.status !== 'running') return this.pumpLater();
      }
      const limit = parallelFor(job, Number(this.getSettings().concurrency) || 0);
      const busy = job.items.filter((i) => i.status === 'running').length;
      const free = limit - busy;
      const next = job.items.filter((i) => i.status === 'queued').slice(0, free);
      next.forEach((item) => this.encode(job, item));
      if (!busy && !next.length) this.finish(job);
    } finally {
      this.pumping = false;
    }
  }

  pumpLater() {
    setImmediate(() => this.pump());
  }

  async prepare(job) {
    job.status = 'preparing';
    job.phase = 'Creating folders';
    job.startedAt = job.startedAt || Date.now();
    this.emitJob(job, true);
    try {
      await fsp.mkdir(job.dest, { recursive: true });
      for (const rel of job.dirs) await fsp.mkdir(path.join(job.dest, rel), { recursive: true });

      if (job.options.copyOthers && job.others.length) {
        job.phase = 'Copying other files';
        for (const o of job.others) {
          if (job.cancelRequested) break;
          const from = path.join(job.source, o.src);
          const to = path.join(job.dest, o.src);
          if (job.sourceKeys.has(keyOf(to)) || keyOf(to) === keyOf(from)) continue;
          if (!(job.options.skipExisting && await exists(to))) {
            try {
              await fsp.copyFile(from, to);
              if (job.options.keepDates) {
                const st = await fsp.stat(from);
                await fsp.utimes(to, st.atime, st.mtime);
              }
            } catch { /* one unreadable extra file should not stop the videos */ }
          }
          job.copied++;
          this.emitJob(job);
        }
      }
      if (job.cancelRequested) return this.finish(job);
      job.status = 'running';
      job.phase = '';
      this.emitJob(job, true);
    } catch (e) {
      job.status = 'failed';
      job.error = `Could not create the output folder: ${e.message}`;
      job.finishedAt = Date.now();
      this.emitJob(job, true);
      this.emit('finished', this.snapshot(job));
    }
  }

  async encode(job, item) {
    item.status = 'running';
    item.startedAt = Date.now();
    item.progress = 0;
    item.error = '';
    item.log = [];
    this.emitJob(job, true);

    const src = path.join(job.source, item.src);
    const out = path.join(job.dest, item.out);
    const parsed = path.parse(out);
    const tmp = path.join(parsed.dir, `${parsed.name}${PARTIAL_TAG}${parsed.ext}`);

    const fail = (msg) => {
      item.status = 'failed';
      item.error = msg;
      item.finishedAt = Date.now();
      this.emitJob(job, true);
      this.pumpLater();
    };

    // Hard safety rule: never write over an original.
    if (keyOf(out) === keyOf(src) || job.sourceKeys.has(keyOf(out))) return fail('Skipped: the output would replace an original video.');

    try {
      await fsp.mkdir(parsed.dir, { recursive: true });
      if (job.options.skipExisting) {
        const st = await fsp.stat(out).catch(() => null);
        if (st && st.size > 0) {
          item.status = 'skipped';
          item.outSize = st.size;
          item.progress = 1;
          item.finishedAt = Date.now();
          this.emitJob(job, true);
          return this.pumpLater();
        }
      }
      await fsp.unlink(tmp).catch(() => {});
    } catch (e) {
      return fail(e.message);
    }

    const cli = this.getCli();
    if (!cli || !fs.existsSync(cli)) return fail('HandBrakeCLI.exe was not found. Set its location in Settings.');

    const args = [];
    const customFile = this.getCustomPresetFile();
    if (job.preset.custom && customFile) args.push('--preset-import-file', customFile);
    args.push('-Z', job.preset.name, '-i', src, '-o', tmp);
    // Turbo: same preset (size, audio, filters, quality) but encoded on the
    // graphics card, which is several times faster.
    if (job.gpuEncoder) args.push('-e', job.gpuEncoder, '--encoder-preset', 'balanced', '--encoder-profile', 'auto', '--encoder-level', 'auto');

    let child;
    try {
      child = spawn(cli, args, { windowsHide: true });
    } catch (e) {
      return fail(`Could not start HandBrake: ${e.message}`);
    }
    this.running.set(item.id, child);
    if (this.getSettings().lowPriority && child.pid) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch { /* not fatal */ }
    }

    let outBuf = '';
    child.stdout.on('data', (buf) => {
      outBuf += buf.toString();
      const parts = outBuf.split(/[\r\n]+/);
      outBuf = parts.pop();
      for (let i = parts.length - 1; i >= 0; i--) {
        const m = PROGRESS_RE.exec(parts[i]);
        if (!m) continue;
        const task = +m[1];
        const tasks = +m[2] || 1;
        item.progress = Math.min(0.999, ((task - 1) + (+m[3] / 100)) / tasks);
        if (m[4]) {
          item.fps = +m[4];
          item.eta = (+m[6]) * 3600 + (+m[7]) * 60 + (+m[8]);
        }
        this.emitJob(job);
        break;
      }
    });
    let errBuf = '';
    child.stderr.on('data', (buf) => {
      errBuf += buf.toString();
      const parts = errBuf.split(/\r?\n/);
      errBuf = parts.pop();
      item.log.push(...parts.filter(Boolean));
      if (item.log.length > 400) item.log.splice(0, item.log.length - 400);
    });

    child.on('error', (e) => {
      this.running.delete(item.id);
      if (item.status === 'running') fail(`Could not start HandBrake: ${e.message}`);
    });

    child.on('close', async (code) => {
      this.running.delete(item.id);
      if (item.status !== 'running') return;
      if (item.cancelled || job.cancelRequested) {
        await fsp.unlink(tmp).catch(() => {});
        item.status = 'cancelled';
        item.finishedAt = Date.now();
        this.emitJob(job, true);
        return this.pumpLater();
      }
      const st = await fsp.stat(tmp).catch(() => null);
      if (code === 0 && st && st.size > 0) {
        try {
          await fsp.rm(out, { force: true });
          await fsp.rename(tmp, out);
          if (job.options.keepDates) {
            const s = await fsp.stat(src);
            await fsp.utimes(out, s.atime, s.mtime);
          }
          item.status = 'done';
          item.outSize = st.size;
          item.progress = 1;
          item.finishedAt = Date.now();
          this.emitJob(job, true);
        } catch (e) {
          fail(`Converted, but could not save the file: ${e.message}`);
          return;
        }
        return this.pumpLater();
      }
      await fsp.unlink(tmp).catch(() => {});
      fail(explainFailure(item.log, code));
    });
  }

  finish(job) {
    if (job.status === 'done' || job.status === 'cancelled' || job.status === 'failed' || job.status === 'partial') return;
    for (const i of job.items) if (i.status === 'queued') i.status = 'cancelled';
    const failed = job.items.filter((i) => i.status === 'failed').length;
    const ok = job.items.filter((i) => i.status === 'done' || i.status === 'skipped').length;
    if (job.cancelRequested) job.status = 'cancelled';
    else if (failed && !ok) job.status = 'failed';
    else if (failed) job.status = 'partial';
    else job.status = 'done';
    job.phase = '';
    job.finishedAt = Date.now();
    this.emitJob(job, true);
    this.emit('finished', this.snapshot(job));
    this.pumpLater();
  }

  cancel(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.status === 'queued') {
      job.cancelRequested = true;
      job.items.forEach((i) => { if (i.status === 'queued') i.status = 'cancelled'; });
      job.status = 'cancelled';
      job.finishedAt = Date.now();
      this.emitJob(job, true);
      return;
    }
    job.cancelRequested = true;
    for (const i of job.items) {
      if (i.status === 'queued') i.status = 'cancelled';
      if (i.status === 'running') {
        i.cancelled = true;
        const child = this.running.get(i.id);
        if (child) child.kill();
      }
    }
    this.emitJob(job, true);
    if (!job.items.some((i) => i.status === 'running') && job.status === 'running') this.finish(job);
  }

  skipItem(jobId, itemId) {
    const job = this.jobs.find((j) => j.id === jobId);
    const item = job && job.items.find((i) => i.id === itemId);
    if (!item) return;
    if (item.status === 'queued') {
      item.status = 'cancelled';
      this.emitJob(job, true);
    } else if (item.status === 'running') {
      item.cancelled = true;
      const child = this.running.get(item.id);
      if (child) child.kill();
    }
  }

  retry(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || ['running', 'preparing', 'queued'].includes(job.status)) return;
    let any = false;
    for (const i of job.items) {
      if (i.status === 'failed' || i.status === 'cancelled') {
        Object.assign(i, { status: 'queued', progress: 0, error: '', cancelled: false, fps: 0, eta: 0 });
        any = true;
      }
    }
    if (!any) return;
    job.cancelRequested = false;
    job.status = 'queued';
    job.error = '';
    job.finishedAt = null;
    this.emitJob(job, true);
    this.pump();
  }

  log(jobId, itemId) {
    const job = this.jobs.find((j) => j.id === jobId);
    const item = job && job.items.find((i) => i.id === itemId);
    return item ? item.log.join('\n') : '';
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => ['running', 'preparing', 'queued'].includes(j.status));
  }

  isBusy() {
    return this.jobs.some((j) => ['running', 'preparing', 'queued'].includes(j.status));
  }

  killAll() {
    for (const job of this.jobs) job.cancelRequested = true;
    for (const [, child] of this.running) child.kill();
  }
}

module.exports = {
  scanFolder, planOutputs, defaultDestination, Converter, isVideo, VIDEO_EXTS, isInside, PARTIAL_TAG, gpuEncoderFor, fileScan, parallelFor,
};
