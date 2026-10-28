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
  buildRoutingInstructions,
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
let isQuitting = false;
let startupWarnings = [];
const activeChecks = new Map();
const cancelledChecks = new Set();
const cancellationReported = new Set();
const mcpRemoteVersion = "0.15.2";

function npxPath() {
  return findExecutable("npx") || "npx";
}

function nodePath() {
  return findExecutable("node");
}

function ensureBridgeRunner() {
  const targetDirectory = path.join(app.getPath("userData"), "bridge-runtime");
  const targetPath = path.join(targetDirectory, "bridge-runner.cjs");
  const sourcePath = path.join(__dirname, "bridge-runner.cjs");
  fs.mkdirSync(targetDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  fs.copyFileSync(sourcePath, temporaryPath);
  fs.chmodSync(temporaryPath, 0o600);
  fs.renameSync(temporaryPath, targetPath);
  return targetPath;
}

function clearBridgeRetryState(profileId) {
  const statePath = path.join(store.authDirectory(profileId), "mmcp-bridge-state.json");
  try { fs.unlinkSync(statePath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function ensureNodeRuntime() {
  if (findExecutable("node") && findExecutable("npx")) return;
  throw new Error("MMCP needs Node.js 20 or newer to run MCP bridges. Install Node.js, then reopen the app.");
}

function oauthClientInfoPath(profile) {
  if (!profile.oauthClientId || !profile.encryptedOauthClientSecret) return "";
  const clientSecret = store.decryptOauthClientSecret(profile);
  const directory = store.authDirectory(profile.id);
  const filePath = path.join(directory, "oauth-client-info.json");
  fs.writeFileSync(filePath, `${JSON.stringify({ client_id: profile.oauthClientId, client_secret: clientSecret })}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

function mcpRemoteArgs(profile, clientMode = false, clientInfoPath = "") {
  const args = clientMode
    ? ["-y", "-p", `mcp-remote@${mcpRemoteVersion}`, "mcp-remote-client", profile.endpoint]
    : ["-y", `mcp-remote@${mcpRemoteVersion}`, profile.endpoint];

  if (profile.oauthCallbackPort) args.push(String(profile.oauthCallbackPort));
  if (clientInfoPath) args.push("--static-oauth-client-info", `@${clientInfoPath}`);

  if (profile.encryptedSecret) {
    args.push("--header", `${profile.headerName}:${profile.headerPrefix ? `${profile.headerPrefix} ` : ""}\${MCP_ACCOUNTS_TOKEN}`);
  }
  return args;
}

async function runBridge() {
  await app.whenReady();
  // A bridge is a headless stdio process launched by an MCP host, not a second
  // MMCP window. Hiding its Dock tile keeps one active connection from looking
  // like a separate open app on macOS.
  if (process.platform === "darwin") app.dock?.hide();
  store = new ProfileStore(app.getPath("userData"));
  const profile = store.get(bridgeProfileId);
  if (!profile) {
    process.stderr.write(`MMCP: profile ${bridgeProfileId} was not found.\n`);
    app.exit(2);
    return;
  }

  const secret = store.decryptSecret(profile);
  const clientInfoPath = oauthClientInfoPath(profile);
  try {
    ensureNodeRuntime();
  } catch (error) {
    process.stderr.write(`MMCP: ${error.message}\n`);
    app.exit(1);
    return;
  }
  const child = spawn(npxPath(), mcpRemoteArgs(profile, false, clientInfoPath), {
    env: bridgeEnvironment({
      MCP_ACCOUNTS_TOKEN: secret,
      MCP_REMOTE_CONFIG_DIR: store.authDirectory(profile.id),
    }),
    stdio: ["inherit", "inherit", "inherit"],
  });

  child.on("error", (error) => {
    process.stderr.write(`MMCP bridge failed: ${redact(error.message)}\n`);
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
    title: "MMCP",
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

  mainWindow.on("close", (event) => {
    // On macOS, the red window button should keep MMCP available in the
    // background. Cmd+Q still performs a genuine quit and retains all saved
    // profiles and OAuth files on disk for the next launch.
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

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
    nodeExecutable: nodePath(),
    bridgeRunnerPath: ensureBridgeRunner(),
    dataDirectory: app.getPath("userData"),
  });
}

const hosts = [
  {
    id: "claude",
    name: "Claude Desktop",
    filePath: path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    appPaths: ["/Applications/Claude.app"],
  },
  {
    id: "cursor",
    name: "Cursor",
    filePath: path.join(os.homedir(), ".cursor", "mcp.json"),
    appPaths: ["/Applications/Cursor.app"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    filePath: path.join(os.homedir(), ".codeium", "windsurf", "mcp_config.json"),
    appPaths: ["/Applications/Windsurf.app"],
  },
  {
    id: "codex",
    name: "Codex",
    filePath: path.join(os.homedir(), ".codex", "config.toml"),
    appPaths: ["/Applications/ChatGPT.app", "/Applications/Codex.app"],
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
  // macOS GUI applications often start with a minimal PATH, so the Codex CLI
  // bundled with the desktop app is not discoverable through `which codex`.
  // Prefer a shell-installed CLI, then use the desktop bundle explicitly.
  const bundledCandidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    path.join(os.homedir(), "Applications", "ChatGPT.app", "Contents", "Resources", "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
    "/Applications/ChatGPT.app/Contents/Resources/codex",
  ];
  return findExecutable("codex") || bundledCandidates.find((candidate) => fs.existsSync(candidate)) || "codex";
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
    ensureCodexStartupTimeout(serverName);
  } catch (error) {
    if (hadOriginal) fs.writeFileSync(host.filePath, original, { mode: 0o600 });
    throw error;
  }

  return { filePath: host.filePath, backupPath, serverName };
}

function ensureCodexStartupTimeout(serverName, timeoutSeconds = 120) {
  const lines = fs.readFileSync(path.join(os.homedir(), ".codex", "config.toml"), "utf8").split(/\r?\n/);
  const tableHeader = `[mcp_servers.${serverName}]`;
  const start = lines.indexOf(tableHeader);
  if (start < 0) throw new Error(`Codex did not write the ${serverName} MCP table to config.toml.`);
  let end = start + 1;
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[end])) end += 1;
  const keyIndex = lines.slice(start + 1, end).findIndex((line) => /^\s*startup_timeout_sec\s*=/.test(line));
  if (keyIndex >= 0) {
    lines[start + 1 + keyIndex] = `startup_timeout_sec = ${timeoutSeconds}`;
  } else {
    lines.splice(start + 1, 0, `startup_timeout_sec = ${timeoutSeconds}`);
  }
  fs.writeFileSync(path.join(os.homedir(), ".codex", "config.toml"), `${lines.join("\n").replace(/\n*$/, "\n")}`, { mode: 0o600 });
}

function codexServerSection(config, serverName) {
  const lines = config.split(/\r?\n/);
  const start = lines.indexOf(`[mcp_servers.${serverName}]`);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n");
}

function migrateJsonHost(host) {
  if (!fs.existsSync(host.filePath)) return false;
  const existing = readJson(host.filePath);
  const servers = existing.mcpServers && typeof existing.mcpServers === "object" ? existing.mcpServers : {};
  const managedIds = [...new Set(Object.values(servers).map(managedProfileId).filter(Boolean))];
  if (!managedIds.length) return false;

  let next = existing;
  for (const profileId of managedIds) {
    const cleaned = removeManagedProfileEntries(next, profileId);
    next = cleaned.config;
    const profile = store.get(profileId);
    if (profile) next = mergeHostConfig(next, profileServerName(profile), bridgeEntry(profile));
  }

  if (JSON.stringify(next) === JSON.stringify(existing)) return false;
  writeJsonWithBackup(host.filePath, next);
  return true;
}

function migrateCodexHost(host) {
  if (!fs.existsSync(host.filePath)) return false;
  const original = fs.readFileSync(host.filePath, "utf8");
  const entries = Object.entries(parseCodexServers(original))
    .map(([name, entry]) => ({ name, entry, profileId: managedProfileId(entry) }))
    .filter((item) => item.profileId);
  if (!entries.length) return false;

  const profiles = new Map();
  let needsMigration = false;
  for (const item of entries) {
    const profile = store.get(item.profileId);
    if (!profile) {
      needsMigration = true;
      continue;
    }
    profiles.set(profile.id, profile);
    const expectedName = profileServerName(profile);
    const expectedEntry = bridgeEntry(profile);
    const timeout = codexServerSection(original, item.name).match(/startup_timeout_sec\s*=\s*(\d+)/)?.[1];
    if (item.name !== expectedName
      || item.entry.command !== expectedEntry.command
      || JSON.stringify(item.entry.args || []) !== JSON.stringify(expectedEntry.args)
      || Number(timeout || 0) < 120) needsMigration = true;
  }
  if (new Set(entries.map((item) => item.profileId)).size !== entries.length) needsMigration = true;
  if (!needsMigration) return false;

  const backupPath = backupExistingFile(host.filePath);
  try {
    for (const { name } of entries) {
      const removed = runCodexMcp(["remove", name]);
      if (removed.status !== 0) throw new Error(codexError(removed));
    }
    for (const profile of profiles.values()) {
      const serverName = profileServerName(profile);
      const entry = bridgeEntry(profile);
      const added = runCodexMcp(["add", serverName, "--", entry.command, ...entry.args]);
      if (added.status !== 0) throw new Error(codexError(added));
      ensureCodexStartupTimeout(serverName);
    }
  } catch (error) {
    if (backupPath) fs.copyFileSync(backupPath, host.filePath);
    else fs.writeFileSync(host.filePath, original, { mode: 0o600 });
    throw error;
  }
  return true;
}

function migrateInstalledBridgeEntries() {
  const warnings = [];
  const updatedHosts = [];
  for (const host of hosts) {
    try {
      const changed = host.id === "codex" ? migrateCodexHost(host) : migrateJsonHost(host);
      if (changed) updatedHosts.push(host.name);
    } catch (error) {
      warnings.push(`${host.name}: ${error.message}`);
    }
  }
  if (updatedHosts.length) warnings.unshift(`MMCP refreshed its connection launcher in ${updatedHosts.join(", ")}. Restart those apps to load the fix.`);
  return warnings;
}

function installHost(host, profile) {
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
}

function hostIsAvailable(host) {
  return fs.existsSync(host.filePath) || host.appPaths.some((appPath) => fs.existsSync(appPath));
}

function installAvailableHosts(profile) {
  const installedHosts = [];
  const warnings = [];
  for (const host of hosts.filter(hostIsAvailable)) {
    try {
      installHost(host, profile);
      installedHosts.push(host.name);
    } catch (error) {
      warnings.push(`${host.name}: ${error.message}`);
    }
  }
  return { installedHosts, warnings };
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
    maintenanceWarnings: startupWarnings,
  }));

  ipcMain.handle("discovery:scan", () => discoverMcpConnections(store));

  ipcMain.handle("profiles:save", (_event, input) => store.upsert(input));
  ipcMain.handle("profiles:routingInstructions", () => buildRoutingInstructions(store.list()));
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
    return installHost(host, profile);
  });

  ipcMain.handle("connections:start", (_event, id) => {
    const profile = store.get(id);
    if (!profile) throw new Error("Connection not found");
    if (activeChecks.has(id)) return { started: false, reason: "already-running" };
    ensureNodeRuntime();
    cancelledChecks.delete(id);
    cancellationReported.delete(id);
    clearBridgeRetryState(id);

    store.setStatus(id, "connecting");
    const secret = store.decryptSecret(profile);
    const clientInfoPath = oauthClientInfoPath(profile);
    const child = spawn(npxPath(), mcpRemoteArgs(profile, true, clientInfoPath), {
      env: bridgeEnvironment({
        MCP_ACCOUNTS_TOKEN: secret,
        MCP_REMOTE_CONFIG_DIR: store.authDirectory(id),
      }),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    activeChecks.set(id, child);

    const send = (kind, message, details = {}) => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow.webContents.send("connection:event", { profileId: id, kind, message: redact(message), ...details });
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
        clearBridgeRetryState(id);
        store.setStatus(id, "connected");
        const installation = installAvailableHosts(profile);
        const installed = installation.installedHosts.length
          ? ` Installed in ${installation.installedHosts.join(", ")}. Restart those AI clients to load it.`
          : " No supported installed AI client was found; use Install after adding one.";
        const warnings = installation.warnings.length
          ? ` Some installations need attention: ${installation.warnings.join(" ")}`
          : "";
        send("complete", `Connection authenticated and tools discovered.${installed}${warnings}`, {
          connectionLabel: `${profile.serviceName} · ${profile.label}`,
          installedHosts: installation.installedHosts,
          installationWarnings: installation.warnings,
        });
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
  app.on("activate", () => {
    const appBundlePath = path.resolve(path.dirname(process.execPath), "..", "..");
    const launcher = spawn("/usr/bin/open", ["-n", "-a", appBundlePath], { detached: true, stdio: "ignore" });
    launcher.unref();
  });
  runBridge();
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      store = new ProfileStore(app.getPath("userData"));
      try {
        ensureBridgeRunner();
        startupWarnings = migrateInstalledBridgeEntries();
      } catch (error) {
        startupWarnings = [`MMCP bridge migration: ${error.message}`];
      }
      registerIpc();
      createWindow();
      app.on("activate", () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("before-quit", () => {
      isQuitting = true;
      for (const [id, child] of activeChecks) {
        cancelledChecks.add(id);
        stopChildProcess(child);
      }
      activeChecks.clear();
    });
  }
}
