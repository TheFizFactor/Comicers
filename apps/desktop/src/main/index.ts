import 'core-js/stable';
import 'regenerator-runtime/runtime';
import fs from 'fs';
import path, { join } from 'path';
import {
  app,
  BrowserWindow,
  shell,
  net,
  protocol,
  ipcMain,
  dialog,
  OpenDialogReturnValue,
} from 'electron';
import log from 'electron-log';
import { walk } from '@/main/util/filesystem';
import { createExtensionIpcHandlers, loadPlugins } from './services/extension';
import ipcChannels from '@/common/constants/ipcChannels.json';
import packageJson from '../../package.json';
import { createTrackerIpcHandlers } from './services/tracker';
import { createDiscordIpcHandlers } from './services/discord';
import { createUpdaterIpcHandlers } from './services/updater';
import { DEFAULT_DOWNLOADS_DIR, LOGS_DIR, PLUGINS_DIR, THUMBNAILS_DIR } from './util/appdata';
import { createFilesystemIpcHandlers } from './services/filesystem';

log.transports.file.resolvePath = () => path.join(LOGS_DIR, 'main.log');

console.info(`Starting Comicers main process (client version ${packageJson.version})`);

let mainWindow: BrowserWindow | null = null;
let spoofWindow: BrowserWindow | null = null;

// Register the app as the default handler for the custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('comicers', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('comicers');
}

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
  require('electron-debug')();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'atom',
    privileges: {
      supportFetchAPI: true,
    },
  },
  {
    scheme: 'comicers',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const createWindows = async () => {
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../resources');
  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
    minWidth: 250,
    minHeight: 150,
    frame: false,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  // mainWindow.loadURL(`file://${__dirname}/index.html`);
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  spoofWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 728,
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    spoofWindow?.close();
  });
  spoofWindow.on('closed', () => {
    spoofWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send(ipcChannels.WINDOW.SET_FULLSCREEN, true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send(ipcChannels.WINDOW.SET_FULLSCREEN, false);
  });
};

// Handle the protocol. In this case, we choose to show the window and load the URL
// This is where we'll handle OAuth callbacks
function handleAuthCallback(url: string) {
  if (!mainWindow) return;
  
  const urlObj = new URL(url);
  // Extract the code parameter from the URL
  const code = urlObj.searchParams.get('code');
  
  if (code) {
    // Send the auth code to the renderer process
    mainWindow.webContents.send(ipcChannels.TRACKERS.AUTH_CALLBACK, code);
    mainWindow.focus();
  }
}

// Windows: register protocol handler callback
if (process.platform === 'win32') {
  // Windows: handle protocol when app is already running
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    
    // The commandLine is array of strings in which the first element is the path to the app
    // and the second element could be the custom protocol URL
    const url = commandLine.find((arg) => arg.startsWith('comicers://'));
    if (url) handleAuthCallback(url);
  });
}

// macOS & Linux: handle protocol
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('comicers://')) {
    handleAuthCallback(url);
  }
});

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(async () => {
    await createWindows();

    // create ipc handlers for specific extension functionality
    createExtensionIpcHandlers(ipcMain, spoofWindow!);
    loadPlugins(spoofWindow!);

    protocol.handle('atom', (req) => {
      const newPath = decodeURIComponent(req.url.slice('atom://'.length));
      return net.fetch(`file://${newPath}`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    });

    // Handle comicers:// protocol
    protocol.handle('comicers', (request) => {
      const url = request.url;
      handleAuthCallback(url);
      
      // Return a success message to the browser
      return new Response('<html><body>Authentication successful! You can close this window.</body></html>', {
        headers: { 'Content-Type': 'text/html' }
      });
    });
  })
  .catch(console.error);

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindows();
});

ipcMain.handle(ipcChannels.WINDOW.MINIMIZE, () => {
  mainWindow?.minimize();
});

ipcMain.handle(ipcChannels.WINDOW.MAX_RESTORE, () => {
  if (mainWindow?.isMaximized()) {
    mainWindow?.restore();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle(ipcChannels.WINDOW.CLOSE, () => {
  mainWindow?.close();
});

ipcMain.handle(ipcChannels.WINDOW.TOGGLE_FULLSCREEN, () => {
  const nowFullscreen = !mainWindow?.fullScreen;
  mainWindow?.setFullScreen(nowFullscreen);
  mainWindow?.webContents.send(ipcChannels.WINDOW.SET_FULLSCREEN, nowFullscreen);
});

ipcMain.handle(ipcChannels.GET_PATH.THUMBNAILS_DIR, () => {
  return THUMBNAILS_DIR;
});

ipcMain.handle(ipcChannels.GET_PATH.PLUGINS_DIR, () => {
  return PLUGINS_DIR;
});

ipcMain.handle(ipcChannels.GET_PATH.DEFAULT_DOWNLOADS_DIR, () => {
  return DEFAULT_DOWNLOADS_DIR;
});

ipcMain.handle(ipcChannels.GET_PATH.LOGS_DIR, () => {
  return LOGS_DIR;
});

ipcMain.handle(ipcChannels.GET_ALL_FILES, (_event, rootPath: string) => {
  return walk(rootPath);
});

ipcMain.handle(
  ipcChannels.APP.SHOW_OPEN_DIALOG,
  (
    _event,
    directory = false,
    filters: { name: string; extensions: string[] }[] = [],
    title: string,
  ) => {
    console.info(`Showing open dialog directory=${directory} filters=${filters.join(';')}`);

    if (mainWindow === null) {
      console.error('Aborting open dialog, mainWindow is null');
      return [];
    }

    return dialog
      .showOpenDialog(mainWindow, {
        properties: [directory ? 'openDirectory' : 'openFile'],
        filters,
        title,
      })
      .then((value: OpenDialogReturnValue) => {
        if (value.canceled) return [];
        return value.filePaths;
      })
      .catch((e) => console.error(e));
  },
);

ipcMain.handle(ipcChannels.APP.READ_ENTIRE_FILE, (_event, filepath: string) => {
  console.info(`Reading entire file: ${filepath}`);

  return fs.readFileSync(filepath).toString();
});

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('high-dpi-support', '1');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}

createFilesystemIpcHandlers(ipcMain);

createTrackerIpcHandlers(ipcMain);
createDiscordIpcHandlers(ipcMain);

createUpdaterIpcHandlers(ipcMain);
