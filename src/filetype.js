'use strict';
// What a downloaded file really is, judged by its first bytes. File names
// and server labels can't be trusted: Tenor sends a video for some ".gif"
// addresses (and a GIF for some ".mp4" ones), and some sites answer a video
// request with a web page. A file whose extension doesn't match what's
// inside won't open, so after every download the name is put right.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Names that mean the same kind of file, so they're left alone.
const SAME = [['jpg', 'jpeg', 'jfif'], ['mp4', 'm4v', 'mov', '3gp'], ['mkv', 'webm'], ['tif', 'tiff']];
const sameKind = (a, b) => a === b || SAME.some((g) => g.includes(a) && g.includes(b));

// { ext, kind } for the bytes, or null if it can't tell.
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  const s = (a, b) => buf.slice(a, b).toString('latin1');
  if (s(0, 4) === 'GIF8') return { ext: 'gif', kind: 'image' };
  if (buf[0] === 0x89 && s(1, 4) === 'PNG') return { ext: 'png', kind: 'image' };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', kind: 'image' };
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return { ext: 'webp', kind: 'image' };
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'AVI ') return { ext: 'avi', kind: 'video' };
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return { ext: 'wav', kind: 'audio' };
  if (s(0, 2) === 'BM' && buf.length > 26) return { ext: 'bmp', kind: 'image' };
  if (s(4, 8) === 'ftyp') {
    const brand = s(8, 12);
    if (/^avi[fs]$/.test(brand)) return { ext: 'avif', kind: 'image' };
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return { ext: 'heic', kind: 'image' };
    if (/^M4A /.test(brand)) return { ext: 'm4a', kind: 'audio' };
    if (brand === 'qt  ') return { ext: 'mov', kind: 'video' };
    return { ext: 'mp4', kind: 'video' };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: s(0, 64).includes('webm') ? 'webm' : 'mkv', kind: 'video' };
  }
  if (s(0, 4) === 'OggS') return { ext: 'ogg', kind: 'audio' };
  if (s(0, 4) === 'fLaC') return { ext: 'flac', kind: 'audio' };
  if (s(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && buf.length > 3 && (buf[1] & 0x06) !== 0)) return { ext: 'mp3', kind: 'audio' };
  // A web page where a picture or video should be.
  const head = s(0, 512).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart().toLowerCase();
  if (/^(<!doctype html|<html|<head|<body|<!--|<meta|<script)/.test(head)) return { ext: 'html', kind: 'page' };
  return null;
}

// Whether a picture's bytes are all there (each format has an end marker).
// A picture read from a page that was still downloading it is cut short.
function looksComplete(buf) {
  const t = sniff(buf);
  if (!t || t.kind !== 'image') return true; // can't tell: assume it's fine
  const n = buf.length;
  if (t.ext === 'jpg') {
    // The end marker (FF D9) can be followed by a little padding.
    for (let i = n - 1; i >= Math.max(1, n - 64); i--) if (buf[i] === 0xd9 && buf[i - 1] === 0xff) return true;
    return false;
  }
  if (t.ext === 'png') return n >= 12 && buf.slice(n - 8, n - 4).toString('latin1') === 'IEND';
  if (t.ext === 'gif') return buf[n - 1] === 0x3b;
  if (t.ext === 'webp') return n >= 12 && buf.readUInt32LE(4) + 8 <= n;
  return true;
}

async function readStart(file, n = 512) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.slice(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function freePath(p) {
  const { dir, name, ext } = path.parse(p);
  let out = p;
  for (let n = 2; fs.existsSync(out); n++) out = path.join(dir, `${name} (${n})${ext}`);
  return out;
}

// Gives a downloaded file the extension that matches what's inside.
// Returns { file, kind } (file may be renamed); kind 'page' means the site
// sent a web page instead of the media, and the caller decides what to do.
async function fixExtension(file) {
  let found = null;
  try {
    found = sniff(await readStart(file));
  } catch {
    return { file, kind: null };
  }
  if (!found) return { file, kind: null };
  if (found.kind === 'page') return { file, kind: 'page' };
  const cur = path.extname(file).slice(1).toLowerCase();
  // Containers and documents are never renamed (a .cbz is a zip, etc.).
  if (/^(zip|cbz|cbr|rar|7z|pdf|epub|docx|xlsx|pptx|apk|exe|iso|torrent)$/.test(cur)) return { file, kind: found.kind };
  if (sameKind(cur, found.ext)) return { file, kind: found.kind };
  const base = cur ? file.slice(0, -(cur.length + 1)) : file;
  const next = await freePath(`${base}.${found.ext}`);
  await fsp.rename(file, next);
  return { file: next, kind: found.kind, renamed: true };
}

module.exports = { sniff, fixExtension, looksComplete };
