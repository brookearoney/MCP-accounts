const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  discoverMcpConnections,
  parseCodexServers,
  sanitizeEndpoint,
} = require("../electron/discovery.cjs");

function writeFixture(homeDir, relativePath, contents) {
  const filePath = path.join(homeDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
}

test("discovery inventories host configs without returning credential values", () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-discovery-"));
  const headerSecret = "Bearer test-secret-that-must-not-leak";
  const querySecret = "query-secret-that-must-not-leak";
  const managedId = "profile-managed-123";
  const profile = {
    id: managedId,
    serviceId: "supabase",
    serviceName: "Supabase",
    label: "Work database",
    endpoint: "https://mcp.supabase.com/mcp?project_ref=project123",
    accountHint: "work@example.test",
    scope: "project123",
  };

  try {
    writeFixture(
      homeDir,
      path.join("Library", "Application Support", "Claude", "claude_desktop_config.json"),
      JSON.stringify({
        mcpServers: {
          github_work: {
            url: "https://api.githubcopilot.com/mcp/",
            headers: { Authorization: headerSecret },
          },
          supabase_managed: {
            command: "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
            args: ["--mcp-profile", managedId],
          },
        },
      }),
    );
    writeFixture(
      homeDir,
      path.join(".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          vercel: { url: `https://mcp.vercel.com/?access_token=${querySecret}` },
        },
      }),
    );
    writeFixture(
      homeDir,
      path.join(".codex", "config.toml"),
      [
        "[mcp_servers.node_repl]",
        'command = "node"',
        'args = ["server.mjs"]',
        "",
        "[mcp_servers.node_repl.env]",
        'PRIVATE_API_KEY = "another-secret"',
      ].join("\n"),
    );

    const profileStore = { get: (id) => id === managedId ? profile : undefined };
    const result = discoverMcpConnections(profileStore, { homeDir });
    const serialized = JSON.stringify(result);

    assert.equal(result.connections.length, 4);
    assert.equal(serialized.includes(headerSecret), false);
    assert.equal(serialized.includes(querySecret), false);
    assert.equal(serialized.includes("another-secret"), false);

    const github = result.connections.find((connection) => connection.serverName === "github_work");
    assert.deepEqual(github.headerKeys, ["Authorization"]);
    assert.equal(github.authKind, "token");
    assert.equal(github.importable, true);

    const managed = result.connections.find((connection) => connection.managedProfileId === managedId);
    assert.equal(managed.profileLabel, "Work database");
    assert.equal(managed.accountHint, "work@example.test");
    assert.equal(managed.importable, false);

    const vercel = result.connections.find((connection) => connection.serverName === "vercel");
    assert.equal(new URL(vercel.endpoint).searchParams.get("access_token"), "[redacted]");

    const local = result.connections.find((connection) => connection.serverName === "node_repl");
    assert.equal(local.authKind, "token");
    assert.equal(local.importable, false);
    assert.deepEqual(local.environmentKeys, ["PRIVATE_API_KEY"]);
    assert.equal(result.connections.some((connection) => connection.serverName === "node_repl.env"), false);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("Codex TOML parser keeps environment metadata attached to its server", () => {
  const result = parseCodexServers('[mcp_servers."my.server"]\nurl = "https://example.test/mcp"\n[mcp_servers."my.server".env]\nTOKEN = "hidden"');
  assert.equal(result['my.server'].url, "https://example.test/mcp");
  assert.equal(result['my.server'].env.TOKEN, "[configured]");
});

test("endpoint sanitization removes URL credentials and redacts secret query values", () => {
  const endpoint = sanitizeEndpoint("https://person:password@example.test/mcp?project_ref=public&api_key=private");
  assert.equal(endpoint.includes("person"), false);
  assert.equal(endpoint.includes("password"), false);
  assert.equal(new URL(endpoint).searchParams.get("project_ref"), "public");
  assert.equal(new URL(endpoint).searchParams.get("api_key"), "[redacted]");
});
