const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MCP_REMOTE_VERSION = "0.15.2";
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000;
const STARTUP_LOCK_MAX_MS = 3 * 60 * 1000;

function executableCandidates(name) {
  const folders = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".volta", "bin"),
    ...String(process.env.PATH || "").split(path.delimiter).filter(Boolean),
    "/usr/bin",
    "/bin",
  ];
  return [...new Set(folders)].map((folder) => path.join(folder, name));
}

function findExecutable(name) {
  return executableCandidates(name).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || "";
}

function runtimePath(npxPath) {
  const folders = [
    path.dirname(npxPath),
    path.dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".volta", "bin"),
    ...String(process.env.PATH || "").split(path.delimiter).filter(Boolean),
    "/usr/bin",
    "/bin",
  ];
  return [...new Set(folders.filter(Boolean))].join(path.delimiter);
}

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function removeState(filePath) {
  try { fs.unlinkSync(filePath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireStartupLock(lockPath, statePath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_LOCK_MAX_MS) {
    const state = readState(statePath);
    if (state.pauseUntilUser) {
      return { blockedUntil: Date.now() + 60_000, reason: state.reason || "reauthentication required" };
    }
    if (state.blockedUntil > Date.now()) {
      return { blockedUntil: state.blockedUntil, reason: state.reason || "connection retry paused" };
    }

    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: Date.now() }), { mode: 0o600 });
      return { release: () => fs.rmSync(lockPath, { recursive: true, force: true }) };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let lock = {};
      try { lock = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8")); } catch {}
      let ownerAlive = false;
      if (Number.isInteger(lock.pid)) {
        try { process.kill(lock.pid, 0); ownerAlive = true; } catch {}
      }
      if (!ownerAlive && (!lock.createdAt || Date.now() - lock.createdAt > 5000)) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      await delay(250);
    }
  }
  const blockedUntil = Date.now() + 30_000;
  writeState(statePath, { blockedUntil, reason: "another MMCP connection is still starting", updatedAt: Date.now() });
  return { blockedUntil, reason: "another MMCP connection is still starting" };
}

function loadProfile(dataDirectory, profileId) {
  const storePath = path.join(dataDirectory, "profiles.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  return (store.profiles || []).find((profile) => profile.id === profileId);
}

function emitDiagnostic(line) {
  const safe = line
    .replace(/https:\/\/[^\s]+\/oauth\/authorize\?[^\s]+/gi, "[OAuth authorization URL hidden]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:token|secret|api[_-]?key|password)\s*[:=]\s*)[^\s,"']+/gi, "$1[redacted]");
  process.stderr.write(`${safe}\n`);
}

async function run() {
  const args = process.argv.slice(2);
  const dataIndex = args.indexOf("--data-dir");
  const profileIndex = args.indexOf("--mcp-profile");
  const dataDirectory = dataIndex >= 0 ? args[dataIndex + 1] : "";
  const profileId = profileIndex >= 0 ? args[profileIndex + 1] : "";
  if (!dataDirectory || !profileId) throw new Error("MMCP bridge requires --data-dir and --mcp-profile.");

  const profile = loadProfile(dataDirectory, profileId);
  if (!profile) throw new Error(`MMCP profile ${profileId} was not found. Open MMCP and reinstall this connection.`);
  if (profile.encryptedSecret || profile.encryptedOauthClientSecret) {
    throw new Error("This profile needs MMCP's secure credential bridge. Open MMCP and reinstall this connection to refresh its launcher.");
  }

  const authDirectory = path.join(dataDirectory, "auth-profiles", profile.id);
  fs.mkdirSync(authDirectory, { recursive: true, mode: 0o700 });
  const statePath = path.join(authDirectory, "mmcp-bridge-state.json");
  const lockPath = path.join(authDirectory, "mmcp-bridge-start.lock");
  const lock = await acquireStartupLock(lockPath, statePath);
  if (!lock.release) {
    const minutes = Math.max(1, Math.ceil((lock.blockedUntil - Date.now()) / 60_000));
    throw new Error(`Automatic connection retries are paused for ${minutes} minute(s) (${lock.reason}). Open MMCP and use Connect to retry.`);
  }

  const npxPath = findExecutable("npx");
  if (!npxPath) {
    lock.release();
    throw new Error("Node.js and npm are required to run this MCP connection.");
  }

  const child = spawn(npxPath, ["-y", `mcp-remote@${MCP_REMOTE_VERSION}`, profile.endpoint], {
    env: {
      ...process.env,
      PATH: runtimePath(npxPath),
      MCP_REMOTE_CONFIG_DIR: authDirectory,
    },
    stdio: ["inherit", "inherit", "pipe"],
  });

  let ready = false;
  let blocked = false;
  let lineBuffer = "";
  const updateState = (extra) => {
    const current = readState(statePath);
    writeState(statePath, { ...current, ...extra, updatedAt: Date.now() });
  };
  const releaseLock = () => lock.release?.();
  const processLine = (line) => {
    if (!line) return;
    if (/Browser opened automatically/i.test(line)
      || /Authentication required\. Initializing auth/i.test(line)
      || /Please authorize this client by visiting:/i.test(line)
      || /https:\/\/[^\s]+\/oauth\/authorize\?/i.test(line)) {
      blocked = true;
      updateState({ pauseUntilUser: true, blockedUntil: 0, reason: "reauthentication required", failures: 0 });
      emitDiagnostic("MMCP: Sign-in is needed. Automatic browser retries are paused; open MMCP and click Connect to reauthenticate.");
      releaseLock();
      return;
    }
    if (/Too Many Requests|status:\s*429|HTTP\s*429/i.test(line)) {
      blocked = true;
      updateState({ blockedUntil: Date.now() + RATE_LIMIT_COOLDOWN_MS, reason: "the MCP service is rate limiting requests" });
      emitDiagnostic("MMCP: The MCP service is rate limiting requests. Automatic retries are paused for 15 minutes.");
      return;
    }
    if (/Local STDIO server running|Proxy established successfully/i.test(line)) {
      ready = true;
      removeState(statePath);
      releaseLock();
    }
    if (/Please authorize this client by visiting:/i.test(line) || /https:\/\/[^\s]+\/oauth\/authorize\?/i.test(line)) return;
    emitDiagnostic(line);
  };

  child.stderr.on("data", (data) => {
    lineBuffer += data.toString();
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  });
  child.on("error", (error) => {
    if (!blocked) updateState({ blockedUntil: Date.now() + 30_000, reason: "the bridge process could not start" });
    emitDiagnostic(`MMCP bridge failed: ${error.message}`);
    releaseLock();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (lineBuffer) processLine(lineBuffer);
    releaseLock();
    if (!ready && !blocked) {
      const previous = readState(statePath);
      const failures = Math.min((previous.failures || 0) + 1, 8);
      const waitMs = Math.min(15_000 * (2 ** (failures - 1)), MAX_RETRY_BACKOFF_MS);
      updateState({ blockedUntil: Date.now() + waitMs, reason: "the MCP connection failed to start", failures });
    }
    if (signal) process.exitCode = 1;
    else process.exitCode = typeof code === "number" ? code : 1;
  });

  const shutdown = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

run().catch((error) => {
  process.stderr.write(`MMCP: ${error.message}\n`);
  process.exitCode = 1;
});
