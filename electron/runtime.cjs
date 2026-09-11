const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function uniqueDirectories(directories) {
  return [...new Set(directories.filter(Boolean))];
}

function executableCandidates(name, environment = process.env, executablePath = process.execPath) {
  const commonDirectories = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".volta", "bin"),
    path.dirname(executablePath),
  ];
  const pathDirectories = String(environment.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  return uniqueDirectories([...commonDirectories, ...pathDirectories]).map((directory) => path.join(directory, name));
}

function findExecutable(name, options = {}) {
  const exists = options.exists || fs.existsSync;
  const candidates = executableCandidates(name, options.environment, options.executablePath);
  return candidates.find((candidate) => exists(candidate)) || "";
}

function runtimePath(options = {}) {
  const environment = options.environment || process.env;
  const npx = options.npxPath || findExecutable("npx", options);
  const node = options.nodePath || findExecutable("node", options);
  const inheritedDirectories = String(environment.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  return uniqueDirectories([
    npx && path.dirname(npx),
    node && path.dirname(node),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".volta", "bin"),
    ...inheritedDirectories,
    "/usr/bin",
    "/bin",
  ]).join(path.delimiter);
}

function bridgeEnvironment(extra, options = {}) {
  const environment = options.environment || process.env;
  return {
    ...environment,
    ...extra,
    PATH: runtimePath({ ...options, environment }),
  };
}

module.exports = {
  bridgeEnvironment,
  findExecutable,
  runtimePath,
};
