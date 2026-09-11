const { app, safeStorage } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ProfileStore } = require("../electron/store.cjs");

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-accounts-smoke-"));
  app.setPath("userData", temporaryRoot);
  await app.whenReady();

  assert.equal(safeStorage.isEncryptionAvailable(), true, "macOS secure storage should be available");
  const store = new ProfileStore(temporaryRoot);
  const rawSecret = "github_pat_smoke_test_only";
  const profile = store.upsert({
    serviceId: "github",
    label: "Smoke test",
    endpoint: "https://api.githubcopilot.com/mcp/",
    authType: "pat",
    secret: rawSecret,
    headerName: "Authorization",
    headerPrefix: "Bearer",
  });

  assert.equal(profile.hasSecret, true);
  assert.equal(store.list()[0].hasSecret, true);
  assert.equal(store.decryptSecret(store.get(profile.id)), rawSecret);
  assert.equal(fs.readFileSync(path.join(temporaryRoot, "profiles.json"), "utf8").includes(rawSecret), false);

  const authDirectory = store.authDirectory(profile.id);
  fs.writeFileSync(path.join(authDirectory, "test-token.json"), "placeholder", { mode: 0o600 });
  const reset = store.resetAuth(profile.id);
  assert.equal(reset.status, "ready");
  assert.equal(fs.existsSync(authDirectory), false);
  fs.mkdirSync(authDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(authDirectory, "test-token.json"), "placeholder", { mode: 0o600 });
  assert.equal(store.remove(profile.id), true);
  assert.equal(fs.existsSync(authDirectory), false);
  assert.equal(store.list().length, 0);

  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  process.stdout.write("Electron secure-storage smoke test passed.\n");
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
