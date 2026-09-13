const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { ProfileStore } = require("./store.cjs");
const { services } = require("./services.cjs");
const { discoverMcpConnections, parseCodexServers } = require("./discovery.cjs");
const { bridgeEnvironment, findExecutable, stopChildProcess } = require("./runtime.cjs");
const {
  buildBridgeCommand,
  managedProfileId,
  mergeHostConfig,
  profileServerName,
  redact,
  removeManagedProfileEntries,
} = require("./core.cjs");

const bridgeArgIndex = process.argv.indexOf("--mcp-profile");
const bridgeProfileId = bridgeArgIndex >= 0 ? process.argv[bridgeArgIndex + 1] : "";
const isBridgeMode = Boolean(bridgeProfileId);

let mainWindow;
let store;
const activeChecks = new Map();
const cancelledChecks = new Set();
const cancellationReported = new Set();

function npxPath() {
  return findExecutable("npx") || "npx";
}

function ensureNodeRuntime() {
  if (findExecutable("node") && findExecutable("npx")) return;
  throw new Error("MCP Accounts needs Node.js 20 or newer to run MCP bridges. Install Node.js, then reopen the app.");
}

function mcpRemoteArgs(profile, clientMode = false) {
  const args = clientMode
    ? ["-y", "-p", "mcp-remote@latest", "mcp-remote-client", profile.endpoint]
    : ["-y", "mcp-remote@latest", profile.endpoint];

  if (profile.encryptedSecret) {
    args.push("--header", `${profile.headerName}:${profile.headerPrefix ? `${profile.headerPrefix} ` : ""}\${MCP_ACCOUNTS_TOKEN}`);
  }
  return args;
}

async function runBridge() {
  await app.whenReady();
  store = new ProfileStore(app.getPath("userData"));
  const profile = store.get(bridgeProfileId);
  if (!profile) {
    process.stderr.write(`MCP Accounts: profile ${bridgeProfileId} was not found.\n`);
    app.exit(2);
    return;
  }

  const secret = store.decryptSecret(profile);
  try {
    ensureNodeRuntime();
  } catch (error) {
    process.stderr.write(`MCP Accounts: ${error.message}\n`);
    app.exit(1);
    return;
  }
  const child = spawn(npxPath(), mcpRemoteArgs(profile), {
    env: bridgeEnvironment({
      MCP_ACCOUNTS_TOKEN: secret,
      MCP_REMOTE_CONFIG_DIR: store.authDirectory(profile.id),
    }),
    stdio: ["inherit", "inherit", "inherit"],
  });

  child.on("error", (error) => {
    process.stderr.write(`MCP Accounts bridge failed: ${redact(error.message)}\n`);
    app.exit(1);
  });
  child.on("exit", (code, signal) => {
    app.exit(typeof code === "number" ? code : signal ? 1 : 0);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: "MCP Accounts",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: "#090b11",
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  if (process.env.MCP_ACCOUNTS_SCREENSHOT_PATH) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const screenshotViews = { guide: 1, detected: 2, clients: 4 };
        const screenshotIndex = screenshotViews[process.env.MCP_ACCOUNTS_SCREENSHOT_VIEW];
        if (Number.isInteger(screenshotIndex)) {
          await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('nav button')[${screenshotIndex}]?.click()`);
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const image = await mainWindow.capturePage();
        fs.writeFileSync(process.env.MCP_ACCOUNTS_SCREENSHOT_PATH, image.toPNG());
        app.quit();
      }, 2500);
    });
  }
}

function bridgeEntry(profile) {
  return buildBridgeCommand({
    profile,
    appPath: app.getAppPath(),
    appExecutable: process.execPath,
    packaged: app.isPackaged,
  });
}

const hosts = [
  {
    id: "claude",
    name: "Claude Desktop",
    filePath: path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  },
  {
    id: "cursor",
    name: "Cursor",
    filePath: path.join(os.homedir(), ".cursor", "mcp.json"),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    filePath: path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"),
  },
  {
    id: "codex",
    name: "Codex",
    filePath: path.join(os.homedir(), ".codex", "config.toml"),
  },
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Could not read ${filePath}: ${error.message}`);
  }
}

function writeJsonWithBackup(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let backupPath = "";
  if (fs.existsSync(filePath)) {
    backupPath = `${filePath}.mcp-accounts-backup-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  return backupPath;
}

function codexPath() {
  return findExecutable("codex") || "codex";
}

function runCodexMcp(args) {
  const result = spawnSync(codexPath(), ["mcp", ...args], {
    encoding: "utf8",
    env: bridgeEnvironment({}),
    timeout: 30000,
  });
  if (result.error) throw new Error(`Could not run Codex: ${result.error.message}`);
  return result;
}

function codexError(result) {
  return redact(String(result.stderr || result.stdout || "Codex rejected the configuration.").trim());
}

function backupExistingFile(filePath) {
  if (!fs.existsSync(filePath)) return "";
  const backupPath = `${filePath}.mcp-accounts-backup-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function codexServerNamesForProfile(profile) {
  if (!fs.existsSync(path.join(os.homedir(), ".codex", "config.toml"))) return [profileServerName(profile)];
  try {
    const config = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
    const names = Object.entries(parseCodexServers(config))
      .filter(([, entry]) => managedProfileId(entry) === profile.id)
      .map(([name]) => name);
    return names.length ? names : [profileServerName(profile)];
  } catch {
    return [profileServerName(profile)];
  }
}

function removeCodexServersForProfile(profile) {
  let removed = 0;
  for (const serverName of codexServerNamesForProfile(profile)) {
    const existing = runCodexMcp(["get", serverName]);
    if (existing.status !== 0) continue;
    const result = runCodexMcp(["remove", serverName]);
    if (result.status !== 0) throw new Error(codexError(result));
    removed += 1;
  }
  return removed;
}

function installCodexHost(host, profile) {
  const serverName = profileServerName(profile);
  const entry = bridgeEntry(profile);
  const hadOriginal = fs.existsSync(host.filePath);
  const original = hadOriginal ? fs.readFileSync(host.filePath, "utf8") : "";
  const backupPath = backupExistingFile(host.filePath);

  try {
    removeCodexServersForProfile(profile);
    const added = runCodexMcp(["add", serverName, "--", entry.command, ...entry.args]);
    if (added.status !== 0) throw new Error(codexError(added));
  } catch (error) {
    if (hadOriginal) fs.writeFileSync(host.filePath, original, { mode: 0o600 });
    throw error;
  }

  return { filePath: host.filePath, backupPath, serverName };
}

function removeInstalledHostEntries(profile) {
  let installationsRemoved = 0;
  const warnings = [];
  for (const host of hosts) {
    if (!fs.existsSync(host.filePath)) continue;
    try {
      if (host.id === "codex") {
        const backupPath = backupExistingFile(host.filePath);
        let removed = 0;
        try {
          removed = removeCodexServersForProfile(profile);
        } catch (error) {
          if (backupPath) fs.copyFileSync(backupPath, host.filePath);
          throw error;
        }
        installationsRemoved += removed;
        continue;
      }
      const result = removeManagedProfileEntries(readJson(host.filePath), profile.id);
      if (!result.removedServerNames.length) continue;
      writeJsonWithBackup(host.filePath, result.config);
      installationsRemoved += result.removedServerNames.length;
    } catch (error) {
      warnings.push(`${host.name}: ${error.message}`);
    }
  }
  return { installationsRemoved, warnings };
}

function registerIpc() {
  ipcMain.handle("app:bootstrap", () => ({
    services,
    profiles: store.list(),
    discovery: discoverMcpConnections(store),
    hosts: hosts.map((host) => ({ ...host, configured: fs.existsSync(host.filePath) })),
    runtime: {
      packaged: app.isPackaged,
      encryptionAvailable: require("electron").safeStorage.isEncryptionAvailable(),
      npx: npxPath(),
    },
  }));

  ipcMain.handle("discovery:scan", () => discoverMcpConnections(store));

  ipcMain.handle("profiles:save", (_event, input) => store.upsert(input));
  ipcMain.handle("profiles:remove", (_event, id) => {
    const profile = store.get(id);
    if (!profile) return { removed: false, installationsRemoved: 0, warnings: [] };
    const child = activeChecks.get(id);
    if (child) {
      cancelledChecks.add(id);
      stopChildProcess(child);
    }
    const removal = removeInstalledHostEntries(profile);
    return { removed: store.remove(id), ...removal };
  });

  ipcMain.handle("profiles:resetAuth", (_event, id) => {
    const child = activeChecks.get(id);
    if (child) {
      cancelledChecks.add(id);
      stopChildProcess(child);
      activeChecks.delete(id);
    }
    return store.resetAuth(id);
  });

  ipcMain.handle("profiles:config", (_event, id) => {
    const profile = store.get(id);
    if (!profile) throw new Error("Connection not found");
    const name = profileServerName(profile);
    return {
      name,
      config: { mcpServers: { [name]: bridgeEntry(profile) } },
    };
  });

  ipcMain.handle("profiles:export", async (_event, id) => {
    const profile = store.get(id);
    if (!profile) throw new Error("Connection not found");
    const name = profileServerName(profile);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export MCP configuration",
      defaultPath: `${name}.mcp.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    writeJsonWithBackup(result.filePath, { mcpServers: { [name]: bridgeEntry(profile) } });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle("hosts:install", (_event, { hostId, profileId }) => {
    const host = hosts.find((candidate) => candidate.id === hostId);
    const profile = store.get(profileId);
    if (!host) throw new Error("Unknown MCP host");
    if (!profile) throw new Error("Connection not found");
    if (host.id === "codex") return installCodexHost(host, profile);
    const name = profileServerName(profile);
    // A label can change over the life of a profile, which changes its server
    // name. Remove every prior bridge entry for this profile before adding the
    // current one, so clients do not start duplicate connections on launch.
    const existing = readJson(host.filePath);
    const cleaned = removeManagedProfileEntries(existing, profile.id);
    const merged = mergeHostConfig(cleaned.config, name, bridgeEntry(profile));
    const backupPath = writeJsonWithBackup(host.filePath, merged);
    return {
      filePath: host.filePath,
      backupPath,
      serverName: name,
      removedServerNames: cleaned.removedServerNames,
    };
  });

  ipcMain.handle("connections:start", (_event, id) => {
    const profile = store.get(id);
    if (!profile) throw new Error("Connection not found");
    if (activeChecks.has(id)) return { started: false, reason: "already-running" };
    ensureNodeRuntime();
    cancelledChecks.delete(id);
    cancellationReported.delete(id);

    store.setStatus(id, "connecting");
    const secret = store.decryptSecret(profile);
    const child = spawn(npxPath(), mcpRemoteArgs(profile, true), {
      env: bridgeEnvironment({
        MCP_ACCOUNTS_TOKEN: secret,
        MCP_REMOTE_CONFIG_DIR: store.authDirectory(id),
      }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    activeChecks.set(id, child);

    const send = (kind, message) => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow.webContents.send("connection:event", { profileId: id, kind, message: redact(message) });
      }
    };
    child.stdout.on("data", (data) => send("output", data.toString()));
    child.stderr.on("data", (data) => send("output", data.toString()));
    child.on("error", (error) => {
      activeChecks.delete(id);
      if (cancelledChecks.has(id)) {
        if (!cancellationReported.has(id)) {
          cancellationReported.add(id);
          send("complete", "Connection canceled. You can try again when you are ready.");
        }
        return;
      }
      const message = redact(error.message);
      store.setStatus(id, "error", message);
      send("error", message);
    });
    child.on("exit", (code) => {
      activeChecks.delete(id);
      if (cancelledChecks.delete(id)) {
        if (store.get(id)) store.setStatus(id, "ready");
        if (!cancellationReported.has(id)) send("complete", "Connection canceled. You can try again when you are ready.");
        cancellationReported.delete(id);
        return;
      }
      if (code === 0) {
        store.setStatus(id, "connected");
        send("complete", "Connection authenticated and tools discovered.");
      } else {
        const message = `Connection check exited with code ${code ?? "unknown"}.`;
        store.setStatus(id, "error", message);
        send("error", message);
      }
    });
    return { started: true };
  });

  ipcMain.handle("connections:cancel", (_event, id) => {
    const child = activeChecks.get(id);
    if (!child) return false;
    cancelledChecks.add(id);
    stopChildProcess(child);
    activeChecks.delete(id);
    store.setStatus(id, "ready");
    return true;
  });

  ipcMain.handle("app:openPath", (_event, targetPath) => shell.showItemInFolder(targetPath));
  ipcMain.handle("app:openExternal", (_event, url) => shell.openExternal(url));
}

if (isBridgeMode) {
  runBridge();
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      store = new ProfileStore(app.getPath("userData"));
      registerIpc();
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("before-quit", () => {
      for (const [id, child] of activeChecks) {
        cancelledChecks.add(id);
        stopChildProcess(child);
      }
      activeChecks.clear();
    });
  }
}
