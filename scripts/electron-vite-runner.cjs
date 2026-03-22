const { spawn } = require('node:child_process')
const path = require('node:path')

const env = { ...process.env }

// Some Windows shells/tools leak this flag globally, which makes Electron run
// as plain Node and breaks main-process APIs like app/ipcMain.
delete env.ELECTRON_RUN_AS_NODE

const args = process.argv.slice(2)
const electronVitePkgPath = require.resolve('electron-vite/package.json')
const cliPath = path.join(path.dirname(electronVitePkgPath), 'dist', 'cli.js')

const child = spawn(process.execPath, [cliPath, ...args], {
  stdio: 'inherit',
  env,
  shell: false
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
