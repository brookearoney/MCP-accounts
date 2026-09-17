const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildBridgeCommand,
  buildEndpoint,
  managedProfileId,
  mergeHostConfig,
  removeManagedProfileEntries,
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

test("Higgsfield always resolves to its official OAuth MCP endpoint", () => {
  const endpoint = buildEndpoint(
    { id: "higgsfield", endpoint: "https://mcp.higgsfield.ai/mcp" },
    { endpoint: "https://untrusted.example/mcp" },
  );
  assert.equal(endpoint, "https://mcp.higgsfield.ai/mcp");
});

test("Supabase access can be changed from read-only to read/write", () => {
  const endpoint = buildEndpoint(
    { id: "supabase", endpoint: "https://mcp.supabase.com/mcp" },
    { endpoint: "https://mcp.supabase.com/mcp?project_ref=abc123&read_only=true", scope: "abc123", readOnly: false },
  );
  assert.equal(new URL(endpoint).searchParams.has("read_only"), false);
});

test("Linear read-only endpoint is isolated", () => {
  const endpoint = buildEndpoint(
    { id: "linear", endpoint: "https://mcp.linear.app/mcp" },
    { readOnly: true },
  );
  assert.equal(endpoint, "https://mcp.linear.app/mcp/readonly");
});

test("Linear access can be changed from read-only to read/write", () => {
  const endpoint = buildEndpoint(
    { id: "linear", endpoint: "https://mcp.linear.app/mcp" },
    { endpoint: "https://mcp.linear.app/mcp/readonly", readOnly: false },
  );
  assert.equal(endpoint, "https://mcp.linear.app/mcp");
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

test("removing a profile removes only its managed host entry", () => {
  const result = removeManagedProfileEntries(
    {
      theme: "dark",
      mcpServers: {
        managed: {
          command: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
          args: ["--mcp-profile", "profile-to-delete"],
        },
        otherManaged: {
          command: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
          args: ["--mcp-profile", "profile-to-keep"],
        },
        unrelated: { command: "other-mcp", args: ["--mcp-profile", "profile-to-delete"] },
      },
    },
    "profile-to-delete",
  );
  assert.deepEqual(result.removedServerNames, ["managed"]);
  assert.equal(result.config.theme, "dark");
  assert.ok(result.config.mcpServers.otherManaged);
  assert.ok(result.config.mcpServers.unrelated);
});

test("MMCP and legacy bridges are all recognized", () => {
  const args = ["--mcp-profile", "profile-id"];
  assert.equal(managedProfileId({ command: "/Applications/MMCP.app/Contents/MacOS/MMCP", args }), "profile-id");
  assert.equal(managedProfileId({ command: "/Applications/Multi-MCP.app/Contents/MacOS/Multi-MCP", args }), "profile-id");
  assert.equal(managedProfileId({ command: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts", args }), "profile-id");
});

test("removing a profile clears duplicate managed entries created before a rename", () => {
  const result = removeManagedProfileEntries(
    {
      mcpServers: {
        oldName: {
          command: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
          args: ["--mcp-profile", "profile-to-keep"],
        },
        currentName: {
          command: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
          args: ["--mcp-profile", "profile-to-keep"],
        },
        unrelated: { command: "other-mcp", args: [] },
      },
    },
    "profile-to-keep",
  );
  assert.deepEqual(result.removedServerNames, ["oldName", "currentName"]);
  assert.deepEqual(Object.keys(result.config.mcpServers), ["unrelated"]);
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
