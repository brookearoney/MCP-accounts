const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBridgeCommand,
  buildEndpoint,
  mergeHostConfig,
  profileServerName,
  publicProfile,
  redact,
  slugify,
} = require("../electron/core.cjs");

test("slugify creates stable MCP-safe names", () => {
  assert.equal(slugify("GitHub · Work Account"), "github_work_account");
  assert.equal(slugify("  "), "connection");
});

test("Supabase endpoint is project-scoped and read-only", () => {
  const endpoint = buildEndpoint(
    { id: "supabase", endpoint: "https://mcp.supabase.com/mcp" },
    { scope: "abc123", readOnly: true, features: "database,docs" },
  );
  const url = new URL(endpoint);
  assert.equal(url.searchParams.get("project_ref"), "abc123");
  assert.equal(url.searchParams.get("read_only"), "true");
  assert.equal(url.searchParams.get("features"), "database,docs");
});

test("Linear read-only endpoint is isolated", () => {
  const endpoint = buildEndpoint(
    { id: "linear", endpoint: "https://mcp.linear.app/mcp" },
    { readOnly: true },
  );
  assert.equal(endpoint, "https://mcp.linear.app/mcp/readonly");
});

test("Sentry endpoint accepts an organization/project scope", () => {
  const endpoint = buildEndpoint(
    { id: "sentry", endpoint: "https://mcp.sentry.dev/mcp" },
    { scope: "/acme/web/" },
  );
  assert.equal(endpoint, "https://mcp.sentry.dev/mcp/acme/web");
});

test("host configuration merge preserves unrelated settings", () => {
  const merged = mergeHostConfig(
    { theme: "dark", mcpServers: { existing: { command: "old" } } },
    "github_work_abcd",
    { command: "/Applications/MCP Accounts", args: ["--mcp-profile", "abcd"] },
  );
  assert.equal(merged.theme, "dark");
  assert.equal(merged.mcpServers.existing.command, "old");
  assert.equal(merged.mcpServers.github_work_abcd.args[1], "abcd");
});

test("bridge commands contain a profile id but no credential", () => {
  const entry = buildBridgeCommand({
    profile: { id: "1234-secret-profile" },
    appPath: "/project",
    appExecutable: "/electron",
    packaged: false,
  });
  assert.deepEqual(entry, {
    command: "/electron",
    args: ["/project", "--mcp-profile", "1234-secret-profile"],
  });
});

test("public profiles never expose encrypted secrets", () => {
  const safe = publicProfile({ id: "1", encryptedSecret: "ciphertext" });
  assert.equal(safe.hasSecret, true);
  assert.equal("encryptedSecret" in safe, false);
});

test("diagnostic text redacts common credentials", () => {
  const result = redact("Authorization: Bearer github_pat_abcdef token=sbp_123456");
  assert.equal(result.includes("github_pat_abcdef"), false);
  assert.equal(result.includes("sbp_123456"), false);
});

test("server names are account-specific", () => {
  const name = profileServerName({ id: "abcd-1234", serviceId: "github", label: "Work" });
  assert.equal(name, "github_work_abcd");
});
