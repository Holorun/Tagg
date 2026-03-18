// Launcher — deletes ELECTRON_RUN_AS_NODE before spawning Electron
// so the app works even when run from inside Claude Code or other
// Electron-based environments that set that variable.
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electronPath, args, { env, stdio: 'inherit' });
child.on('close', code => process.exit(code ?? 0));
