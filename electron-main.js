const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { lerPlanilhaFarm } = require('./farm-excel');

let observadorExcel = null;
let temporizadorExcel = null;
let janelaPrincipal = null;

// O banco local do Electron não deve ser aberto por vários processos ao mesmo
// tempo. Em vez de iniciar uma segunda cópia, trazemos a janela existente.
const instanciaUnica = app.requestSingleInstanceLock();
if (!instanciaUnica) app.quit();

function caminhoConfigExcel() {
  return path.join(app.getPath('userData'), 'farm-excel.json');
}

function lerConfigExcel() {
  try {
    const config = JSON.parse(fs.readFileSync(caminhoConfigExcel(), 'utf8'));
    return config && typeof config === 'object' ? config : {};
  } catch (_erro) {
    return {};
  }
}

function salvarConfigExcel(config) {
  fs.writeFileSync(caminhoConfigExcel(), JSON.stringify(config), 'utf8');
}

function estadoExcel() {
  const config = lerConfigExcel();
  const existe = Boolean(config.caminho && fs.existsSync(config.caminho));
  return {
    disponivel: true,
    configurada: existe,
    arquivo: existe ? path.basename(config.caminho) : null,
    atualizadoEm: config.atualizadoEm || null,
    erro: config.caminho && !existe ? 'A planilha não foi encontrada. Escolha o arquivo novamente.' : null,
  };
}

function avisarAlteracaoExcel() {
  BrowserWindow.getAllWindows().forEach(janela => {
    janela.webContents.send('farm-excel:alterado');
  });
}

function observarPlanilhaExcel() {
  if (observadorExcel) {
    observadorExcel.close();
    observadorExcel = null;
  }
  const { caminho } = lerConfigExcel();
  if (!caminho || !fs.existsSync(caminho)) return;

  try {
    observadorExcel = fs.watch(caminho, { persistent: false }, () => {
      clearTimeout(temporizadorExcel);
      temporizadorExcel = setTimeout(avisarAlteracaoExcel, 900);
    });
  } catch (_erro) {
    // O botão “Importar agora” continua disponível caso o Windows não permita observar o arquivo.
  }
}

ipcMain.handle('farm-excel:estado', () => estadoExcel());
ipcMain.handle('farm-excel:escolher-arquivo', async () => {
  const config = lerConfigExcel();
  const resultado = await dialog.showOpenDialog({
    title: 'Escolha a planilha de contas do FARM',
    defaultPath: config.caminho || undefined,
    filters: [{ name: 'Planilhas Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  });
  if (resultado.canceled || !resultado.filePaths[0]) return estadoExcel();

  const caminho = resultado.filePaths[0];
  // Valida o formato antes de substituir a conexão atual.
  lerPlanilhaFarm(caminho);
  salvarConfigExcel({ caminho, atualizadoEm: null });
  observarPlanilhaExcel();
  return estadoExcel();
});
ipcMain.handle('farm-excel:ler', () => {
  const config = lerConfigExcel();
  const planilha = lerPlanilhaFarm(config.caminho);
  salvarConfigExcel({ ...config, atualizadoEm: planilha.atualizadoEm });
  return planilha;
});

function createWindow() {
  janelaPrincipal = new BrowserWindow({
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
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // Em monitores Windows com escala de 125%/150%, a PWA ficava grande demais
  // dentro da janela desktop. Mantém uma proporção confortável sem alterar a
  // versão instalada no celular.
  janelaPrincipal.webContents.setZoomFactor(0.9);
  janelaPrincipal.loadFile(path.join(__dirname, 'index.html'));
  janelaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  janelaPrincipal.on('closed', () => { janelaPrincipal = null; });
}

if (instanciaUnica) {
  app.on('second-instance', () => {
    if (!janelaPrincipal) return;
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.focus();
  });

  app.whenReady().then(() => {
    observarPlanilhaExcel();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (observadorExcel) observadorExcel.close();
});
