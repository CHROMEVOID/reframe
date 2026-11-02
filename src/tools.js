'use strict';
// Optional helper programs Reframe downloads on request into its own data
// folder: yt-dlp (online video downloader) and FFmpeg (merging, thumbnails).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const SOURCES = {
  ytdlp: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  ffmpeg: 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip',
};

async function downloadTo(url, dest, onProgress, signal) {
  const res = await fetch(url, { redirect: 'follow', signal, headers: { 'User-Agent': 'Reframe' } });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    const now = Date.now();
    if (onProgress && now - last > 150) {
      last = now;
      onProgress(done, total);
    }
  });
  await pipeline(body, fs.createWriteStream(dest));
  if (onProgress) onProgress(done, total || done);
}

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: opts.timeout || 60000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

class Tools {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'tools');
    fs.mkdirSync(this.dir, { recursive: true });
    this.ytdlpPath = path.join(this.dir, 'yt-dlp.exe');
    this.ffmpegDir = path.join(this.dir, 'ffmpeg');
    this.ffmpegPath = path.join(this.ffmpegDir, 'ffmpeg.exe');
    this.ffprobePath = path.join(this.ffmpegDir, 'ffprobe.exe');
    this.busy = {};
    this.versions = {};
  }

  hasYtdlp() {
    return fs.existsSync(this.ytdlpPath);
  }

  hasFfmpeg() {
    return fs.existsSync(this.ffmpegPath) && fs.existsSync(this.ffprobePath);
  }

  async status() {
    if (this.hasYtdlp() && !this.versions.ytdlp) {
      const r = await run(this.ytdlpPath, ['--version'], { timeout: 20000 });
      if (r.ok) this.versions.ytdlp = r.stdout.trim();
    }
    return {
      ytdlp: { installed: this.hasYtdlp(), version: this.versions.ytdlp || null, busy: this.busy.ytdlp || null },
      ffmpeg: { installed: this.hasFfmpeg(), busy: this.busy.ffmpeg || null },
    };
  }

  // Installs (or updates, by re-downloading the latest release) a tool.
  async install(name, onProgress) {
    if (this.busy[name]) throw new Error('Already downloading.');
    this.busy[name] = { done: 0, total: 0 };
    const report = (done, total) => {
      this.busy[name] = { done, total };
      if (onProgress) onProgress(name, done, total);
    };
    try {
      if (name === 'ytdlp') {
        const tmp = `${this.ytdlpPath}.download`;
        await downloadTo(SOURCES.ytdlp, tmp, report);
        await fsp.rm(this.ytdlpPath, { force: true });
        await fsp.rename(tmp, this.ytdlpPath);
        this.versions.ytdlp = null;
      } else if (name === 'ffmpeg') {
        const zip = path.join(this.dir, 'ffmpeg.zip');
        const unpack = path.join(this.dir, 'ffmpeg-unpack');
        await downloadTo(SOURCES.ffmpeg, zip, report);
        await fsp.rm(unpack, { recursive: true, force: true });
        await fsp.mkdir(unpack, { recursive: true });
        // Windows 10/11 ship bsdtar, which reads zip files.
        const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
        const r = await run(tar, ['-xf', zip, '-C', unpack], { timeout: 300000 });
        if (!r.ok) throw new Error('Could not unpack FFmpeg.');
        const bin = await findBin(unpack);
        if (!bin) throw new Error('FFmpeg download did not contain ffmpeg.exe.');
        await fsp.rm(this.ffmpegDir, { recursive: true, force: true });
        await fsp.rename(bin, this.ffmpegDir);
        await fsp.rm(unpack, { recursive: true, force: true });
        await fsp.rm(zip, { force: true });
      } else {
        throw new Error('Unknown tool.');
      }
    } finally {
      delete this.busy[name];
    }
    return this.status();
  }

  // A thumbnail and length for any format, used when the built-in player
  // can't decode a file (AVI, WMV, ...).
  async probe(file, thumbOut) {
    if (!this.hasFfmpeg()) return null;
    const meta = { duration: 0, width: 0, height: 0 };
    const r = await run(this.ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { timeout: 30000 });
    if (r.ok) {
      try {
        const j = JSON.parse(r.stdout);
        meta.duration = Number(j.format && j.format.duration) || 0;
        meta.width = (j.streams && j.streams[0] && j.streams[0].width) || 0;
        meta.height = (j.streams && j.streams[0] && j.streams[0].height) || 0;
      } catch { /* keep zeros */ }
    }
    const at = meta.duration ? Math.min(meta.duration * 0.2, 45) : 1;
    const t = await run(this.ffmpegPath, ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=increase,crop=480:270', '-q:v', '4', thumbOut], { timeout: 60000 });
    return { meta, thumb: t.ok && fs.existsSync(thumbOut) };
  }
}

async function findBin(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((e) => e.isFile() && e.name.toLowerCase() === 'ffmpeg.exe')) return d;
    for (const e of entries) if (e.isDirectory()) stack.push(path.join(d, e.name));
  }
  return null;
}

// Lists the graphics-card encoders this HandBrake build can use here.
async function detectGpuEncoders(cli) {
  if (!cli || !fs.existsSync(cli)) return [];
  const r = await run(cli, ['--help'], { timeout: 40000 });
  const text = r.stdout + r.stderr;
  const block = text.split(/--encoder <string>/)[1] || '';
  const list = block.split(/--encoder-preset/)[0] || '';
  return [...new Set((list.match(/\b(?:vce|nvenc|qsv)_[a-z0-9_]+/g) || []))];
}

module.exports = { Tools, downloadTo, detectGpuEncoders, run, spawn };
