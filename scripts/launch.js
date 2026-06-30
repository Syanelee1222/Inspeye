#!/usr/bin/env node
// Launch script — ensures ELECTRON_RUN_AS_NODE is not set
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Clean environment
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const appPath = path.join(__dirname, '..');

// Use project-local userData dir to avoid AppData lockfile permission issues
const userDataDir = path.join(appPath, '.electron-data');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const args = [appPath, '--user-data-dir=' + userDataDir, ...process.argv.slice(2)];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  windowsHide: false,
  detached: false
});

child.on('close', (code) => {
  process.exit(code);
});
