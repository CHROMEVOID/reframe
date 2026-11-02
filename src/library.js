'use strict';
// The media library: videos plus nested categories, stored as one JSON file.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');

const COLORS = ['#ff7a3d', '#ff4f6e', '#b26bff', '#5b8cff', '#2ec5d3', '#3ddc97', '#ffc04d', '#f472b6'];

let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const keyOf = (p) => path.resolve(p).toLowerCase();

class Library extends EventEmitter {
  constructor(dir) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.thumbDir = path.join(dir, 'thumbs');
    this.data = { categories: [], videos: [] };
    fs.mkdirSync(this.thumbDir, { recursive: true });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.categories) && Array.isArray(raw.videos)) this.data = raw;
    } catch { /* first run */ }
  }

  get() {
    return this.data;
  }

  changed() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
    this.emit('changed', this.data);
  }

  flush() {
    clearTimeout(this.saveTimer);
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch { /* keep in memory; next change retries */ }
  }

  nextColor() {
    return COLORS[this.data.categories.length % COLORS.length];
  }

  descendants(id) {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of this.data.categories) {
        if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
          out.add(c.id);
          grew = true;
        }
      }
    }
    return out;
  }

  createCategory({ name, parentId = null, color }) {
    name = String(name || '').trim();
    if (!name) throw new Error('Give the category a name.');
    const parent = parentId ? this.data.categories.find((c) => c.id === parentId) : null;
    const cat = {
      id: uid('c'),
      name,
      parentId: parent ? parent.id : null,
      color: color || this.nextColor(),
      createdAt: Date.now(),
    };
    this.data.categories.push(cat);
    this.changed();
    return cat;
  }

  findOrCreate(name, parentId, extra = {}) {
    const hit = this.data.categories.find((c) => c.parentId === parentId && c.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
    const cat = this.createCategory({ name, parentId });
    Object.assign(cat, extra);
    return cat;
  }

  updateCategory(id, patch) {
    const cat = this.data.categories.find((c) => c.id === id);
    if (!cat) return;
    if (patch.name !== undefined) {
      const name = String(patch.name).trim();
      if (name) cat.name = name;
    }
    if (patch.color) cat.color = patch.color;
    if (patch.parentId !== undefined) {
      // A category cannot be moved inside itself.
      if (patch.parentId === null || !this.descendants(id).has(patch.parentId)) cat.parentId = patch.parentId;
    }
    this.changed();
  }

  deleteCategory(id) {
    const gone = this.descendants(id);
    this.data.categories = this.data.categories.filter((c) => !gone.has(c.id));
    for (const v of this.data.videos) v.categoryIds = v.categoryIds.filter((c) => !gone.has(c));
    this.changed();
  }

  assign(videoIds, categoryId, { move = false } = {}) {
    const ids = new Set(videoIds);
    for (const v of this.data.videos) {
      if (!ids.has(v.id)) continue;
      if (move) v.categoryIds = [];
      if (categoryId && !v.categoryIds.includes(categoryId)) v.categoryIds.push(categoryId);
    }
    this.changed();
  }

  unassign(videoIds, categoryId) {
    const ids = new Set(videoIds);
    for (const v of this.data.videos) if (ids.has(v.id)) v.categoryIds = v.categoryIds.filter((c) => c !== categoryId);
    this.changed();
  }

  renameVideo(id, title) {
    const v = this.data.videos.find((x) => x.id === id);
    if (v) {
      v.title = String(title || '').trim() || null;
      this.changed();
    }
  }

  removeVideos(videoIds) {
    const ids = new Set(videoIds);
    for (const v of this.data.videos) {
      if (ids.has(v.id) && v.thumb) fsp.unlink(path.join(this.thumbDir, v.thumb)).catch(() => {});
    }
    this.data.videos = this.data.videos.filter((v) => !ids.has(v.id));
    this.changed();
  }

  // Adds videos found under rootAbs. With autoCategorize, a category named
  // after the folder is made and every subfolder becomes a sub-category, so
  // the library mirrors the folder layout.
  addTree(rootAbs, rootName, files, { autoCategorize = true, source = null, origin = 'import', parentCategoryId = null } = {}) {
    const byPath = new Map(this.data.videos.map((v) => [keyOf(v.path), v]));
    const rootCat = autoCategorize ? this.findOrCreate(rootName, parentCategoryId) : null;
    let added = 0;
    for (const f of files) {
      let cat = rootCat;
      if (autoCategorize) {
        const segs = path.dirname(f.rel).split(/[\\/]/).filter((s) => s && s !== '.');
        for (const seg of segs) cat = this.findOrCreate(seg, cat.id);
      }
      const abs = path.join(rootAbs, f.rel);
      let v = byPath.get(keyOf(abs));
      if (!v) {
        v = {
          id: uid('v'),
          path: abs,
          name: path.basename(abs),
          title: null,
          size: f.size || 0,
          duration: 0,
          width: 0,
          height: 0,
          thumb: null,
          source: f.source || source || null,
          origin,
          favourite: false,
          categoryIds: [],
          addedAt: Date.now(),
        };
        this.data.videos.push(v);
        byPath.set(keyOf(abs), v);
        added++;
      } else {
        // A video the user converts/downloads stops being "just scanned".
        if (v.origin === 'scan' && origin !== 'scan') v.origin = origin;
        if (f.size) v.size = f.size;
        if (f.source) v.source = f.source;
        if (f.fresh) {
          // Re-converted file: its old thumbnail and length are stale.
          v.thumb = null;
          v.duration = 0;
        }
      }
      if (cat && !v.categoryIds.includes(cat.id)) v.categoryIds.push(cat.id);
    }
    this.changed();
    return { added, categoryId: rootCat ? rootCat.id : null };
  }

  // Results of a whole-PC scan go under "On this PC", one category per place
  // (Videos, Downloads, E: drive...). Inside, only folders that actually hold
  // videos become categories, nested under the closest such folder above
  // them, so empty in-between folders don't clutter the tree.
  addScanned(groups) {
    const top = this.findOrCreate('On this PC', null);
    top.origin = 'scan';
    const byPath = new Map(this.data.videos.map((v) => [keyOf(v.path), v]));
    let added = 0;
    for (const g of groups) {
      const place = this.findOrCreate(g.label, top.id);
      place.origin = 'scan';
      const dirs = new Set(g.files.map((f) => path.dirname(f.rel)).filter((d) => d && d !== '.'));
      const sorted = [...dirs].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
      const catFor = new Map();
      for (const d of sorted) {
        let parentDir = null;
        for (let p = path.dirname(d); p && p !== '.' && p !== path.dirname(p); p = path.dirname(p)) {
          if (dirs.has(p)) {
            parentDir = p;
            break;
          }
        }
        const parentCat = parentDir ? catFor.get(parentDir) : place;
        const name = path.relative(parentDir || '', d).split(path.sep).join(' › ');
        const cat = this.findOrCreate(name, parentCat.id);
        cat.origin = 'scan';
        catFor.set(d, cat);
      }
      for (const f of g.files) {
        const d = path.dirname(f.rel);
        const cat = d && d !== '.' ? catFor.get(d) : place;
        let v = byPath.get(keyOf(f.abs));
        if (!v) {
          v = {
            id: uid('v'), path: f.abs, name: path.basename(f.abs), title: null, size: f.size, duration: 0, width: 0, height: 0,
            thumb: null, source: null, origin: 'scan', favourite: false, categoryIds: [], addedAt: Date.now(),
          };
          this.data.videos.push(v);
          byPath.set(keyOf(f.abs), v);
          added++;
        }
        if (!v.categoryIds.includes(cat.id)) v.categoryIds.push(cat.id);
      }
    }
    this.changed();
    return { added, categoryId: top.id };
  }

  setFavourite(ids, value) {
    const set = new Set(ids);
    for (const v of this.data.videos) if (set.has(v.id)) v.favourite = !!value;
    this.changed();
  }

  // Small updates (thumbnails) are sent as patches instead of the whole library.
  patch(v, fields) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 1500);
    this.emit('patch', { id: v.id, ...fields });
  }

  async saveThumb(id, dataUrl, meta = {}) {
    const v = this.data.videos.find((x) => x.id === id);
    if (!v) return null;
    if (meta.duration) v.duration = meta.duration;
    if (meta.width) v.width = meta.width;
    if (meta.height) v.height = meta.height;
    if (dataUrl && dataUrl.startsWith('data:image/jpeg;base64,')) {
      const name = `${v.id}.jpg`;
      await fsp.writeFile(path.join(this.thumbDir, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
      v.thumb = name;
      v.thumbAt = Date.now();
    } else {
      v.thumb = 'none';
    }
    this.patch(v, { thumb: v.thumb, thumbAt: v.thumbAt, duration: v.duration, width: v.width, height: v.height });
    return v;
  }

  // Thumbnail made by FFmpeg straight into the thumbs folder.
  setThumbFile(id, ok, meta = {}) {
    const v = this.data.videos.find((x) => x.id === id);
    if (!v) return null;
    Object.assign(v, { duration: meta.duration || v.duration, width: meta.width || v.width, height: meta.height || v.height });
    v.thumb = ok ? `${v.id}.jpg` : 'none';
    v.thumbAt = Date.now();
    this.patch(v, { thumb: v.thumb, thumbAt: v.thumbAt, duration: v.duration, width: v.width, height: v.height });
    return v;
  }

  async checkMissing() {
    const missing = [];
    await Promise.all(this.data.videos.map(async (v) => {
      try {
        await fsp.access(v.path);
      } catch {
        missing.push(v.id);
      }
    }));
    return missing;
  }

  clearThumbs() {
    for (const v of this.data.videos) {
      if (v.thumb && v.thumb !== 'none') fsp.unlink(path.join(this.thumbDir, v.thumb)).catch(() => {});
      v.thumb = null;
    }
    this.changed();
  }

  // Forgets everything a PC scan added (videos that were only found by the
  // scan, and its categories).
  forgetScanned() {
    const gone = new Set(this.data.videos.filter((v) => v.origin === 'scan').map((v) => v.id));
    this.removeVideos([...gone]);
    const top = this.data.categories.find((c) => c.origin === 'scan' && !c.parentId);
    if (top) this.deleteCategory(top.id);
  }

  reset() {
    this.clearThumbs();
    this.data = { categories: [], videos: [] };
    this.changed();
  }
}

module.exports = { Library, COLORS };
