const { URL } = require("node:url");

function slugify(value) {
  return String(value || "connection")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "connection";
}

function buildEndpoint(service, input) {
  const raw = String(input.endpoint || service.endpoint || "").trim();
  if (!raw) return "";

  const url = new URL(raw);
  if (service.id === "supabase") {
    if (input.scope) url.searchParams.set("project_ref", input.scope.trim());
    if (input.readOnly) url.searchParams.set("read_only", "true");
    if (input.features) url.searchParams.set("features", input.features.trim());
  }

  if (service.id === "sentry" && input.scope) {
    const suffix = input.scope.trim().replace(/^\/+|\/+$/g, "");
    if (suffix) url.pathname = `/mcp/${suffix}`;
  }

  if (service.id === "linear" && input.readOnly) {
    url.pathname = "/mcp/readonly";
  }

  return url.toString();
}

function profileServerName(profile) {
  const base = slugify(`${profile.serviceId}_${profile.label}`);
  return `${base}_${profile.id.slice(0, 4)}`;
}

function buildBridgeCommand({ profile, appPath, appExecutable, packaged }) {
  const args = packaged
    ? ["--mcp-profile", profile.id]
    : [appPath, "--mcp-profile", profile.id];

  return {
    command: appExecutable,
    args,
  };
}

function mergeHostConfig(existing, serverName, serverEntry) {
  const root = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing }
    : {};
  root.mcpServers = {
    ...(root.mcpServers && typeof root.mcpServers === "object" ? root.mcpServers : {}),
    [serverName]: serverEntry,
  };
  return root;
}

function redact(value) {
  return String(value || "")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s"']+/gi, "$1[redacted]")
    .replace(/((?:token|secret|api[_-]?key|password)\s*[:=]\s*)[^\s,"']+/gi, "$1[redacted]")
    .replace(/\b(?:gh[pousr]_|github_pat_|sk_(?:live|test)_|sbp_)[A-Za-z0-9_-]+\b/g, "[redacted]");
}

function publicProfile(profile) {
  const { encryptedSecret, ...safe } = profile;
  return { ...safe, hasSecret: Boolean(encryptedSecret) };
}

module.exports = {
  buildBridgeCommand,
  buildEndpoint,
  mergeHostConfig,
  profileServerName,
  publicProfile,
  redact,
  slugify,
};
