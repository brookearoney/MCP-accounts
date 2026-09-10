const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { safeStorage } = require("electron");
const { buildEndpoint, publicProfile } = require("./core.cjs");
const { serviceById } = require("./services.cjs");

class ProfileStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "profiles.json");
    this.authRoot = path.join(userDataPath, "auth-profiles");
    this.data = { version: 1, profiles: [] };
    this.load();
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(this.data.profiles)) throw new Error("Invalid profile store");
    } catch (error) {
      if (error.code !== "ENOENT") {
        const backup = `${this.filePath}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(this.filePath, backup); } catch {}
      }
      this.data = { version: 1, profiles: [] };
    }
    fs.mkdirSync(this.authRoot, { recursive: true, mode: 0o700 });
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }

  list() {
    return this.data.profiles.map(publicProfile);
  }

  get(id) {
    return this.data.profiles.find((profile) => profile.id === id);
  }

  upsert(input) {
    const service = serviceById[input.serviceId];
    if (!service) throw new Error("Unknown service");
    if (!input.label || !input.label.trim()) throw new Error("A connection name is required");

    const endpoint = buildEndpoint(service, input);
    if (!endpoint) throw new Error("This service needs a Streamable HTTP MCP endpoint");
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error("MCP endpoints must use HTTPS, except localhost development endpoints");
    }

    const existing = input.id ? this.get(input.id) : undefined;
    const now = new Date().toISOString();
    const id = existing?.id || crypto.randomUUID();
    const secret = typeof input.secret === "string" ? input.secret.trim() : "";
    let encryptedSecret = existing?.encryptedSecret;
    if (secret) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("macOS secure storage is unavailable");
      encryptedSecret = safeStorage.encryptString(secret).toString("base64");
    }

    const profile = {
      id,
      serviceId: service.id,
      serviceName: service.name,
      label: input.label.trim(),
      accountHint: String(input.accountHint || "").trim(),
      scope: String(input.scope || "").trim(),
      endpoint,
      authType: input.authType || service.authModes[0],
      headerName: String(input.headerName || "Authorization").trim(),
      headerPrefix: String(input.headerPrefix ?? "Bearer").trim(),
      readOnly: Boolean(input.readOnly),
      features: String(input.features || "").trim(),
      status: existing?.status || "ready",
      lastError: "",
      encryptedSecret,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const index = this.data.profiles.findIndex((candidate) => candidate.id === id);
    if (index >= 0) this.data.profiles[index] = profile;
    else this.data.profiles.unshift(profile);
    this.save();
    return publicProfile(profile);
  }

  setStatus(id, status, lastError = "") {
    const profile = this.get(id);
    if (!profile) return;
    profile.status = status;
    profile.lastError = lastError;
    profile.updatedAt = new Date().toISOString();
    this.save();
  }

  remove(id) {
    const previousLength = this.data.profiles.length;
    this.data.profiles = this.data.profiles.filter((profile) => profile.id !== id);
    if (this.data.profiles.length === previousLength) return false;
    this.save();
    const authPath = path.join(this.authRoot, id);
    if (authPath.startsWith(`${this.authRoot}${path.sep}`)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
    return true;
  }

  decryptSecret(profile) {
    if (!profile?.encryptedSecret) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("macOS secure storage is unavailable");
    return safeStorage.decryptString(Buffer.from(profile.encryptedSecret, "base64"));
  }

  authDirectory(id) {
    const directory = path.join(this.authRoot, id);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }
}

module.exports = { ProfileStore };
