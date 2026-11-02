'use strict';
// Dev helper: runs the app with a throwaway data folder, drives it with a
// steps module and saves screenshots.
// Usage: electron scripts/shoot.js <steps.js> <out dir> <data dir>
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const [stepsFile, outDir, dataDir] = process.argv.slice(-3).map((p) => path.resolve(p));
fs.mkdirSync(outDir, { recursive: true });
app.setPath('userData', dataDir);

let started = false;
app.on('browser-window-created', (_e, win) => {
  // Only drive the main window; hidden helper windows are left alone.
  if (started) return;
  started = true;
  win.webContents.on('console-message', (_ev, level, message) => {
    if (level >= 2) console.log(`[renderer] ${message}`);
  });
  win.webContents.once('did-finish-load', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const js = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name) => {
      // A background window may not repaint; force a fresh frame.
      win.showInactive();
      win.webContents.invalidate();
      await wait(450);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
      console.log(`shot ${name}`);
    };
    try {
      await wait(800);
      await require(stepsFile)({ win, js, shot, wait });
    } catch (e) {
      console.log(`steps failed: ${e.stack || e}`);
    }
    win.forceClose = true;
    app.exit(0);
  });
});

require('../src/main.js');
