const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let botProcess = null;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: "Minecraft Bot Manager",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Hide the default window menu bar
  mainWindow.setMenu(null);

  // Native context menu on right click
  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Quit', role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' }
        ]
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About Minecraft Bot Manager',
            click: () => {
              const { dialog } = require('electron');
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'About',
                message: 'Minecraft Bot Manager',
                detail: 'A professional Electron dashboard interface wrapper for Minecraft AI agents.'
              });
            }
          }
        ]
      }
    ]);
    contextMenu.popup();
  });

  console.log('[Electron] Spawning bot runner subprocess (node src/bot.js)...');
  // Spawn bot Express/Socket.io server
  botProcess = spawn('node', [path.join(__dirname, 'src/bot.js')], {
    cwd: __dirname,
    env: process.env
  });

  let dashboardReady = false;

  botProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(`[Bot Output]: ${text}`);
    if (text.includes('[Dashboard Server]') && !dashboardReady) {
      dashboardReady = true;
      console.log('[Electron] Dashboard server ready detected, loading UI...');
      if (mainWindow) {
        mainWindow.loadURL('http://localhost:3000');
      }
    }
  });

  botProcess.stderr.on('data', (data) => {
    console.error(`[Bot Error]: ${data}`);
  });

  // Load Express dashboard once started (with automatic retry on connection failure)
  setTimeout(() => {
    if (mainWindow && !dashboardReady) {
      console.log('[Electron] Startup timeout reached, loading URL fallback...');
      mainWindow.loadURL('http://localhost:3000');
    }
  }, 4000);

  // WebContents event handler to retry if connection refused on startup
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL === 'http://localhost:3000/') {
      console.log('[Electron] Dashboard URL connection failed. Retrying in 1.5 seconds...');
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL('http://localhost:3000');
        }
      }, 1500);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (botProcess) {
      console.log('[Electron] Terminating bot child process...');
      botProcess.kill();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (botProcess) botProcess.kill();
    app.quit();
  }
});
