const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { bridgeEnvironment, findExecutable, runtimePath, stopChildProcess } = require("../electron/runtime.cjs");

test("runtime lookup finds Homebrew or installer Node even when a GUI PATH omits it", () => {
  const existing = new Set(["/usr/local/bin/node", "/usr/local/bin/npx"]);
  const options = {
    environment: { PATH: "/usr/bin:/bin" },
    executablePath: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
    exists: (candidate) => existing.has(candidate),
  };
  assert.equal(findExecutable("node", options), "/usr/local/bin/node");
  assert.equal(findExecutable("npx", options), "/usr/local/bin/npx");
  assert.equal(runtimePath(options).split(path.delimiter)[0], "/usr/local/bin");
});

test("bridge environment retains the resolved Node directory and profile variables", () => {
  const environment = bridgeEnvironment(
    { MCP_ACCOUNTS_TOKEN: "test-only", MCP_REMOTE_CONFIG_DIR: "/tmp/profile" },
    { environment: { PATH: "/usr/bin:/bin" }, npxPath: "/usr/local/bin/npx", nodePath: "/usr/local/bin/node" },
  );
  assert.equal(environment.PATH.split(path.delimiter)[0], "/usr/local/bin");
  assert.equal(environment.MCP_ACCOUNTS_TOKEN, "test-only");
  assert.equal(environment.MCP_REMOTE_CONFIG_DIR, "/tmp/profile");
});

test("cancellation terminates the spawned Unix process group", () => {
  const signals = [];
  const child = { pid: 731, kill: () => assert.fail("group termination should be used") };
  assert.equal(stopChildProcess(child, { platform: "darwin", kill: (...args) => signals.push(args) }), true);
  assert.deepEqual(signals, [[-731, "SIGTERM"]]);
});
