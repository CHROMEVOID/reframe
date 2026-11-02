'use strict';
// Copies the packed app to %LOCALAPPDATA%\Programs\Reframe and adds Desktop
// and Start menu shortcuts (with the app id Windows needs for notifications).
// Usage: electron scripts/install.js
const { app, shell } = require('electron');

// Treat app.asar as a plain file so it can be replaced.
process.noAsar = true;
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const from = path.join(__dirname, '..', 'dist', 'Reframe-win32-x64');
  const to = path.join(process.env.LOCALAPPDATA, 'Programs', 'Reframe');
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  const exe = path.join(to, 'Reframe.exe');
  const opts = {
    target: exe,
    cwd: to,
    icon: exe,
    iconIndex: 0,
    description: 'Convert whole folders of video with HandBrake',
    appUserModelId: 'com.chr0m3void.reframe',
  };
  const links = [
    path.join(app.getPath('desktop'), 'Reframe.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Reframe.lnk'),
  ];
  for (const l of links) console.log(`${shell.writeShortcutLink(l, 'create', opts) ? 'created' : 'FAILED'} ${l}`);
  console.log(`installed to ${to}`);
  app.quit();
});
