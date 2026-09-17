const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const jsonHosts = [
  {
    id: "claude",
    name: "Claude Desktop",
    relativePath: path.join("Library", "Application Support", "Claude", "claude_desktop_config.json"),
    roots: ["mcpServers", "servers"],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    relativePath: ".claude.json",
    roots: ["mcpServers"],
  },
  {
    id: "cursor",
    name: "Cursor",
    relativePath: path.join(".cursor", "mcp.json"),
    roots: ["mcpServers", "servers"],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    relativePath: path.join(".codeium", "windsurf", "mcp_config.json"),
    roots: ["mcpServers", "servers"],
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    relativePath: path.join("Library", "Application Support", "Code", "User", "mcp.json"),
    roots: ["servers", "mcpServers"],
  },
  {
    id: "zed",
    name: "Zed",
    relativePath: path.join(".config", "zed", "settings.json"),
    roots: ["context_servers"],
  },
];

const codexHost = {
  id: "codex",
  name: "Codex",
  relativePath: path.join(".codex", "config.toml"),
};

function stableId(parts) {
  return crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20);
}

function safeRead(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > 10 * 1024 * 1024) throw new Error("Configuration file is larger than 10 MB");
  return fs.readFileSync(filePath, "utf8");
}

function parseJsonConfig(filePath) {
  return JSON.parse(safeRead(filePath));
}

function parseTomlValue(raw) {
  const value = raw.trim();
  if (!value) return "";
  try {
    return JSON.parse(value);
  } catch {
    const stringMatch = value.match(/^['"](.*)['"]$/);
    return stringMatch ? stringMatch[1] : value;
  }
}

function parseCodexServers(contents) {
  const servers = {};
  let currentName = "";
  let inEnvironment = false;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const envSection = line.match(/^\[mcp_servers\.([^\]]+)\.env\]$/);
    if (envSection) {
      currentName = envSection[1].replace(/^['"]|['"]$/g, "");
      inEnvironment = true;
      servers[currentName] ||= { env: {} };
      continue;
    }

    const section = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (section) {
      currentName = section[1].replace(/^['"]|['"]$/g, "");
      inEnvironment = false;
      servers[currentName] ||= { env: {} };
      continue;
    }

    if (line.startsWith("[")) {
      currentName = "";
      inEnvironment = false;
      continue;
    }
    if (!currentName) continue;

    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    if (inEnvironment) servers[currentName].env[key] = "[configured]";
    else servers[currentName][key] = parseTomlValue(rawValue);
  }
  return servers;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function extractEndpoint(entry) {
  const direct = entry.url || entry.serverUrl || entry.endpoint;
  if (typeof direct === "string" && /^https?:\/\//i.test(direct)) return direct;
  const candidate = stringArray(entry.args).find((argument) => /^https?:\/\//i.test(argument));
  return candidate || "";
}

function sanitizeEndpoint(endpoint) {
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|password|authorization|signature|credential/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function managedProfileId(entry) {
  const command = String(entry.command || "");
  const args = stringArray(entry.args);
  const index = args.indexOf("--mcp-profile");
  if (!/(?:MCP Accounts|Multi-MCP|MMCP)(?:\.app)?/i.test(command) || index < 0) return "";
  return args[index + 1] || "";
}

function identifyService(serverName, endpoint, command, args) {
  const haystack = [serverName, endpoint, command, ...args].join(" ").toLowerCase();
  const patterns = [
    ["supabase", /supabase/],
    ["github", /github|githubcopilot/],
    ["vercel", /vercel/],
    ["higgsfield", /higgsfield/],
    ["posthog", /posthog/],
    ["neon", /(?:neon\.tech|neondb|neon)/],
    ["notion", /notion/],
    ["hubspot", /hubspot/],
    ["slack", /slack/],
    ["shopify", /shopify/],
    ["framer", /framer/],
    ["linear", /linear/],
    ["sentry", /sentry/],
    ["stripe", /stripe/],
    ["cloudflare", /cloudflare/],
    ["atlassian", /atlassian|jira|confluence/],
  ];
  return patterns.find(([, pattern]) => pattern.test(haystack))?.[0] || "custom";
}

function inferredScope(serviceId, endpoint) {
  if (!endpoint) return "";
  try {
    const url = new URL(endpoint);
    if (serviceId === "supabase") return url.searchParams.get("project_ref") || "";
    if (serviceId === "sentry") return url.pathname.replace(/^\/mcp\/?/, "");
    return "";
  } catch {
    return "";
  }
}

function inferAuth(entry, endpoint, profileId) {
  if (profileId) return { authKind: "managed", authState: "managed", suggestedAuthType: "oauth" };
  const envKeys = Object.keys(entry.env || {});
  const headerKeys = Object.keys(entry.headers || {});
  const args = stringArray(entry.args).join(" ");
  const hasTokenMarker = [...envKeys, ...headerKeys].some((key) => /token|secret|key|authorization/i.test(key))
    || /authorization\s*:/i.test(args);
  if (hasTokenMarker) return { authKind: "token", authState: "configured", suggestedAuthType: "bearer" };
  if (/^https:\/\//i.test(endpoint)) return { authKind: "oauth", authState: "host-managed", suggestedAuthType: "oauth" };
  return { authKind: "local", authState: "local", suggestedAuthType: "oauth" };
}

function sanitizeCommand(command) {
  if (!command) return "";
  return path.basename(String(command));
}

function toDetection({ host, filePath, serverName, entry, profileStore }) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const args = stringArray(entry.args);
  const endpoint = extractEndpoint(entry);
  const profileId = managedProfileId(entry);
  const managedProfile = profileId ? profileStore?.get(profileId) : undefined;
  const serviceId = managedProfile?.serviceId || identifyService(serverName, endpoint, entry.command, args);
  const auth = profileId && !managedProfile
    ? { authKind: "managed", authState: "stale", suggestedAuthType: "oauth" }
    : inferAuth(entry, endpoint, profileId);
  const isRemote = /^https?:\/\//i.test(endpoint);
  const publicEndpoint = sanitizeEndpoint(managedProfile?.endpoint || endpoint);

  return {
    id: stableId([host.id, filePath, serverName]),
    hostId: host.id,
    hostName: host.name,
    serverName,
    serviceId,
    serviceName: managedProfile?.serviceName || "",
    endpoint: publicEndpoint,
    command: sanitizeCommand(entry.command),
    scope: managedProfile?.scope || inferredScope(serviceId, endpoint),
    accountHint: managedProfile?.accountHint || "",
    profileLabel: managedProfile?.label || serverName,
    managedProfileId: managedProfile?.id || "",
    staleManagedProfile: Boolean(profileId && !managedProfile),
    authKind: auth.authKind,
    authState: auth.authState,
    suggestedAuthType: auth.suggestedAuthType,
    importable: isRemote && !managedProfile,
    sourcePath: filePath,
    environmentKeys: Object.keys(entry.env || {}).filter((key) => !/^MCP_ACCOUNTS_TOKEN$/i.test(key)),
    headerKeys: Object.keys(entry.headers || {}),
  };
}

function scanJsonHost(host, homeDir, profileStore, warnings) {
  const filePath = path.join(homeDir, host.relativePath);
  if (!fs.existsSync(filePath)) return [];
  try {
    const config = parseJsonConfig(filePath);
    const root = host.roots.map((key) => config[key]).find((value) => value && typeof value === "object") || {};
    return Object.entries(root)
      .map(([serverName, entry]) => toDetection({ host, filePath, serverName, entry, profileStore }))
      .filter(Boolean);
  } catch (error) {
    warnings.push({ hostName: host.name, sourcePath: filePath, message: error.message });
    return [];
  }
}

function scanCodex(homeDir, profileStore, warnings) {
  const filePath = path.join(homeDir, codexHost.relativePath);
  if (!fs.existsSync(filePath)) return [];
  try {
    const servers = parseCodexServers(safeRead(filePath));
    return Object.entries(servers)
      .map(([serverName, entry]) => toDetection({ host: codexHost, filePath, serverName, entry, profileStore }))
      .filter(Boolean);
  } catch (error) {
    warnings.push({ hostName: codexHost.name, sourcePath: filePath, message: error.message });
    return [];
  }
}

function discoverMcpConnections(profileStore, options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const warnings = [];
  const connections = [
    ...jsonHosts.flatMap((host) => scanJsonHost(host, homeDir, profileStore, warnings)),
    ...scanCodex(homeDir, profileStore, warnings),
  ];

  connections.sort((left, right) => left.hostName.localeCompare(right.hostName) || left.serverName.localeCompare(right.serverName));
  return {
    scannedAt: new Date().toISOString(),
    connections,
    warnings,
    scannedHosts: [...jsonHosts.map(({ id, name, relativePath }) => ({ id, name, sourcePath: path.join(homeDir, relativePath) })), {
      id: codexHost.id,
      name: codexHost.name,
      sourcePath: path.join(homeDir, codexHost.relativePath),
    }],
  };
}

module.exports = {
  discoverMcpConnections,
  identifyService,
  parseCodexServers,
  sanitizeEndpoint,
  toDetection,
};
