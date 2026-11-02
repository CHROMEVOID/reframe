'use strict';
// Renders assets/logo.svg into assets/icon.png and a multi-size assets/icon.ico.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const assets = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(assets, 'logo.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Each size is drawn straight from the SVG onto a canvas so small sizes stay crisp.
async function renderAll() {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const out = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    return ${JSON.stringify(SIZES)}.map((s) => {
      const c = document.createElement('canvas'); c.width = s; c.height = s;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, s, s);
      return c.toDataURL('image/png').split(',')[1];
    });
  })()`);
  win.destroy();
  return out.map((b) => Buffer.from(b, 'base64'));
}

app.whenReady().then(async () => {
  const pngs = await renderAll();
  fs.writeFileSync(path.join(assets, 'icon.png'), pngs[pngs.length - 1]);

  // ICO with PNG-compressed entries (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(SIZES.length, 4);
  const dir = Buffer.alloc(16 * SIZES.length);
  let offset = 6 + dir.length;
  SIZES.forEach((s, i) => {
    const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o);
    dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(pngs[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, dir, ...pngs]));
  console.log('icon.png and icon.ico written');
  app.quit();
});
