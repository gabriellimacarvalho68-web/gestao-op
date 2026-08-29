const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 650,
    title: 'Gestão OP',
    icon: path.join(__dirname, 'icons', 'icon-512.png'),
    backgroundColor: '#F5F5F7',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Em monitores Windows com escala de 125%/150%, a PWA ficava grande demais
  // dentro da janela desktop. Mantém uma proporção confortável sem alterar a
  // versão instalada no celular.
  window.webContents.setZoomFactor(0.9);
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
