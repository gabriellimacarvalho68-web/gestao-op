const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gestaoOpExcel', {
  estado: () => ipcRenderer.invoke('farm-excel:estado'),
  escolherArquivo: () => ipcRenderer.invoke('farm-excel:escolher-arquivo'),
  ler: () => ipcRenderer.invoke('farm-excel:ler'),
  aoAlterar: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('farm-excel:alterado', listener);
    return () => ipcRenderer.removeListener('farm-excel:alterado', listener);
  },
});
