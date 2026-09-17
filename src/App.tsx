import { FormEvent, useEffect, useMemo, useState } from "react";
import mmcpLogo from "../MMCP.svg";
import fullWordmark from "../Word Mark (full).svg";
import type {
  AuthType,
  BootstrapData,
  ConnectionEvent,
  DetectedConnection,
  HostDefinition,
  Profile,
  ProfileInput,
  ServiceDefinition,
} from "./types";

type View = "connections" | "guide" | "detected" | "catalog" | "clients" | "about";

const authNames: Record<AuthType, string> = {
  oauth: "Browser OAuth",
  pat: "Personal access token",
  apiKey: "API key",
  apiToken: "API token",
  bearer: "Bearer token",
};

const maturityNames = {
  official: "Official remote",
  restricted: "Provider approval",
  adapter: "Custom adapter",
  custom: "Custom",
};

const emptyInput: ProfileInput = {
  serviceId: "supabase",
  label: "",
  accountHint: "",
  scope: "",
  endpoint: "",
  authType: "oauth",
  secret: "",
  headerName: "Authorization",
  headerPrefix: "Bearer",
  readOnly: true,
  features: "",
};

function Icon({ service, size = "normal" }: { service: ServiceDefinition; size?: "normal" | "large" }) {
  return (
    <span
      className={`service-icon ${size === "large" ? "service-icon-large" : ""}`}
      style={{ "--service-color": service.color } as React.CSSProperties}
    >
      {service.monogram}
    </span>
  );
}

function Status({ profile }: { profile: Profile }) {
  const label = {
    ready: "Ready",
    connecting: "Connecting",
    connected: "Connected",
    error: "Needs attention",
  }[profile.status];
  return <span className={`status status-${profile.status}`}><i />{label}</span>;
}

function AddConnection({
  service,
  profile,
  onClose,
  onSaved,
  onRemove,
  onResetAuth,
  initialInput,
}: {
  service: ServiceDefinition;
  profile?: Profile;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
  onRemove?: () => void;
  onResetAuth?: () => void | Promise<void>;
  initialInput?: Partial<ProfileInput>;
}) {
  const [input, setInput] = useState<ProfileInput>(() => ({
    ...emptyInput,
    ...initialInput,
    id: profile?.id,
    serviceId: service.id,
    label: profile?.label || initialInput?.label || "",
    accountHint: profile?.accountHint || initialInput?.accountHint || "",
    scope: profile?.scope || initialInput?.scope || "",
    endpoint: profile?.endpoint || initialInput?.endpoint || service.endpoint,
    authType: service.id === "higgsfield" ? "oauth" : (profile?.authType || initialInput?.authType || service.authModes[0]),
    headerName: profile?.headerName || initialInput?.headerName || "Authorization",
    headerPrefix: profile?.headerPrefix ?? initialInput?.headerPrefix ?? "Bearer",
    readOnly: profile?.readOnly ?? initialInput?.readOnly ?? Boolean(service.supportsReadOnly),
    features: profile?.features || initialInput?.features || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const needsSecret = input.authType !== "oauth";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = await window.mcpAccounts.saveProfile(input);
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <header className="modal-header">
          <div className="modal-title-wrap">
            <Icon service={service} size="large" />
            <div>
              <p className="eyebrow">{profile ? "Edit connection" : "New connection"}</p>
              <h2>{service.name}</h2>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>

        {service.maturity === "restricted" && (
          <div className="notice warning">
            Vercel currently accepts reviewed MCP clients. Authentication through this bridge needs compatibility testing.
          </div>
        )}
        {service.maturity === "adapter" && (
          <div className="notice">
            This service needs a compatible custom Streamable HTTP MCP endpoint. The first-party API adapter is on the roadmap.
          </div>
        )}
        {service.id === "higgsfield" && (
          <div className="notice">
            <strong>Official OAuth connection.</strong> MMCP connects directly to Higgsfield MCP. No API key is needed; the browser sign-in uses this profile’s isolated OAuth storage. Higgsfield charges standard credits for MCP generations.
          </div>
        )}

        <div className="form-grid">
          <label className="field full">
            <span>Connection name</span>
            <input
              autoFocus
              required
              value={input.label}
              onChange={(event) => setInput({ ...input, label: event.target.value })}
              placeholder="Work, Personal, Client staging…"
            />
          </label>

          <label className="field">
            <span>Account hint</span>
            <input
              value={input.accountHint}
              onChange={(event) => setInput({ ...input, accountHint: event.target.value })}
              placeholder="email@example.com"
            />
          </label>

          <label className="field">
            <span>{service.scopeLabel}</span>
            <input
              value={input.scope}
              onChange={(event) => setInput({ ...input, scope: event.target.value })}
              placeholder={service.id === "sentry" ? "org/project" : "Optional"}
            />
          </label>

          <label className="field full">
            <span>MCP endpoint</span>
            <input
              required
              readOnly={service.endpointLocked}
              value={input.endpoint}
              onChange={(event) => setInput({ ...input, endpoint: event.target.value })}
              placeholder="https://service.example.com/mcp"
            />
          </label>

          <label className="field">
            <span>Authentication</span>
            <select
              value={input.authType}
              disabled={service.id === "higgsfield"}
              onChange={(event) => setInput({ ...input, authType: event.target.value as AuthType })}
            >
              {service.authModes.map((mode) => <option key={mode} value={mode}>{authNames[mode]}</option>)}
            </select>
          </label>

          {needsSecret ? (
            <label className="field">
              <span>{authNames[input.authType]}</span>
              <input
                type="password"
                required={!profile?.hasSecret}
                value={input.secret}
                onChange={(event) => setInput({ ...input, secret: event.target.value })}
                placeholder={profile?.hasSecret ? "Stored — enter to replace" : "Stored with macOS encryption"}
              />
            </label>
          ) : (
            <div className="field oauth-explainer">
              <span>Sign-in behavior</span>
              <p>Your browser opens during the first connection test. This profile gets its own OAuth storage directory.</p>
            </div>
          )}

          {service.supportsReadOnly && (
            <label className="toggle-row full">
              <div>
                <strong>Read-only</strong>
                <span>Hide or reject mutating tools where the provider supports it.</span>
              </div>
              <input
                type="checkbox"
                checked={input.readOnly}
                onChange={(event) => setInput({ ...input, readOnly: event.target.checked })}
              />
            </label>
          )}

          {service.id === "supabase" && (
            <label className="field full">
              <span>Feature groups</span>
              <input
                value={input.features}
                onChange={(event) => setInput({ ...input, features: event.target.value })}
                placeholder="database,docs,debug (optional)"
              />
            </label>
          )}

          {needsSecret && (
            <details className="advanced full">
              <summary>Advanced header settings</summary>
              <div className="form-grid compact">
                <label className="field">
                  <span>Header name</span>
                  <input value={input.headerName} onChange={(event) => setInput({ ...input, headerName: event.target.value })} />
                </label>
                <label className="field">
                  <span>Value prefix</span>
                  <input value={input.headerPrefix} onChange={(event) => setInput({ ...input, headerPrefix: event.target.value })} placeholder="Bearer" />
                </label>
              </div>
            </details>
          )}
        </div>

        {error && <div className="form-error">{error}</div>}

        <footer className="modal-footer">
          {input.authType === "oauth" && profile && onResetAuth && <button type="button" className="button ghost" onClick={onResetAuth}>Reset sign-in</button>}
          {profile && onRemove && <button type="button" className="button danger-button" onClick={onRemove}>Remove</button>}
          <span className="footer-spacer" />
          <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={saving}>{saving ? "Saving…" : profile ? "Save changes" : "Add connection"}</button>
        </footer>
      </form>
    </div>
  );
}

function ConfigSheet({
  profile,
  hosts,
  onClose,
  notify,
}: {
  profile: Profile;
  hosts: HostDefinition[];
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [config, setConfig] = useState("");
  const [working, setWorking] = useState("");

  useEffect(() => {
    window.mcpAccounts.getConfig(profile.id).then((result) => setConfig(JSON.stringify(result.config, null, 2)));
  }, [profile.id]);

  async function install(host: HostDefinition) {
    setWorking(host.id);
    try {
      const result = await window.mcpAccounts.installHost(host.id, profile.id);
      notify(`Installed as ${result.serverName}. Restart ${host.name} to load it.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking("");
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal config-modal">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Install connection</p>
            <h2>{profile.serviceName} · {profile.label}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </header>
        <div className="host-options">
          {hosts.map((host) => (
            <div className="host-option" key={host.id}>
              <div>
                <strong>{host.name}</strong>
                <span>{host.configured ? "Existing configuration found" : "Configuration will be created"}</span>
              </div>
              <button className="button small" disabled={Boolean(working)} onClick={() => install(host)}>
                {working === host.id ? "Installing…" : "Install"}
              </button>
            </div>
          ))}
        </div>
        <div className="code-wrap">
          <div className="code-heading">
            <span>Portable configuration</span>
            <button
              className="text-button"
              onClick={async () => {
                await navigator.clipboard.writeText(config);
                notify("Configuration copied.");
              }}
            >Copy</button>
          </div>
          <pre>{config || "Generating…"}</pre>
        </div>
        <footer className="modal-footer">
          <button className="button ghost" onClick={() => window.mcpAccounts.exportConfig(profile.id)}>Export JSON…</button>
          <button className="button primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

function App() {
  const [data, setData] = useState<BootstrapData>();
  const [view, setView] = useState<View>("connections");
  const [addingService, setAddingService] = useState<ServiceDefinition>();
  const [editingProfile, setEditingProfile] = useState<Profile>();
  const [discoverySeed, setDiscoverySeed] = useState<Partial<ProfileInput>>();
  const [configProfile, setConfigProfile] = useState<Profile>();
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");

  const refresh = () => window.mcpAccounts.bootstrap().then(setData);

  useEffect(() => {
    refresh();
    return window.mcpAccounts.onConnectionEvent((event: ConnectionEvent) => {
      setLogs((previous) => ({
        ...previous,
        [event.profileId]: [...(previous[event.profileId] || []), ...event.message.split("\n").filter(Boolean)].slice(-30),
      }));
      if (event.kind === "complete" || event.kind === "error") refresh();
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const serviceMap = useMemo(
    () => Object.fromEntries((data?.services || []).map((service) => [service.id, service])),
    [data?.services],
  );

  const filteredProfiles = (data?.profiles || []).filter((profile) => {
    const haystack = `${profile.serviceName} ${profile.label} ${profile.accountHint} ${profile.scope}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const importableDetections = (data?.discovery.connections || []).filter((connection) => connection.importable);

  function notify(message: string) {
    setToast(message);
  }

  async function startConnection(profile: Profile) {
    setLogs((previous) => ({ ...previous, [profile.id]: ["Starting isolated connection check…"] }));
    try {
      await window.mcpAccounts.startConnection(profile.id);
      await refresh();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function cancelConnection(profile: Profile) {
    try {
      const canceled = await window.mcpAccounts.cancelConnection(profile.id);
      if (!canceled) return;
      setLogs((previous) => ({
        ...previous,
        [profile.id]: [...(previous[profile.id] || []), "Connection canceled. You can retry when you are ready."],
      }));
      await refresh();
      notify("Connection canceled. The profile is ready to retry.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function scanConnections() {
    try {
      const discovery = await window.mcpAccounts.scanConnections();
      setData((previous) => previous ? { ...previous, discovery } : previous);
      notify(`Found ${discovery.connections.length} configured MCP connection${discovery.connections.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function importDetection(connection: DetectedConnection) {
    const service = serviceMap[connection.serviceId] || serviceMap.custom;
    const authType = service.authModes.includes(connection.suggestedAuthType)
      ? connection.suggestedAuthType
      : service.authModes.find((mode) => mode !== "oauth") || service.authModes[0];
    setDiscoverySeed({
      serviceId: service.id,
      label: connection.profileLabel,
      accountHint: connection.accountHint,
      scope: connection.scope,
      endpoint: connection.endpoint,
      authType,
      secret: "",
      headerName: "Authorization",
      headerPrefix: "Bearer",
      readOnly: false,
      features: "",
    });
    setEditingProfile(undefined);
    setAddingService(service);
  }

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Remove “${profile.serviceName} · ${profile.label}”? Its local sign-in data and MMCP entries installed in supported clients will be removed.`)) return;
    const result = await window.mcpAccounts.removeProfile(profile.id);
    if (!result.removed) {
      notify("Connection was already removed.");
      return;
    }
    await refresh();
    const cleanup = result.installationsRemoved ? ` Removed ${result.installationsRemoved} installed client entr${result.installationsRemoved === 1 ? "y" : "ies"}.` : "";
    const warning = result.warnings.length ? " Some client configuration files could not be updated." : "";
    notify(`Connection removed.${cleanup}${warning}`);
  }

  function openProfileEditor(profile: Profile) {
    const service = serviceMap[profile.serviceId];
    if (!service) {
      notify("The saved service preset is unavailable.");
      return;
    }
    setDiscoverySeed(undefined);
    setEditingProfile(profile);
    setAddingService(service);
  }

  async function resetProfileAuth(profile: Profile) {
    if (!window.confirm(`Reset the saved sign-in for “${profile.serviceName} · ${profile.label}”? You will sign in again, but this profile and its installed client entries stay in place.`)) return;
    try {
      await window.mcpAccounts.resetProfileAuth(profile.id);
      setAddingService(undefined);
      setEditingProfile(undefined);
      await refresh();
      notify("Sign-in reset. Click Connect to authenticate again.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (!data) {
    return <div className="loading"><div className="loader" /><span>Opening secure profile store…</span></div>;
  }

  const navItems: { id: View; label: string; glyph: string }[] = [
    { id: "connections", label: "Connections", glyph: "⌘" },
    { id: "guide", label: "How to connect", glyph: "?" },
    { id: "detected", label: "Detected on Mac", glyph: "◎" },
    { id: "catalog", label: "Service catalog", glyph: "◫" },
    { id: "clients", label: "AI clients", glyph: "↗" },
    { id: "about", label: "About", glyph: "i" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-lockup"><img src={mmcpLogo} alt="MMCP" /><small>Local profile manager</small></div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              <i>{item.glyph}</i>{item.label}
              {item.id === "connections" && <b>{data.profiles.length}</b>}
              {item.id === "detected" && <b>{data.discovery.connections.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="secure-state"><span>●</span><div><strong>Local-only</strong><small>{data.runtime.encryptionAvailable ? "macOS encryption active" : "Encryption unavailable"}</small></div></div>
          <span className="version">MVP 0.4.0</span>
        </div>
      </aside>

      <main className="main">
        {view === "connections" && (
          <>
            <header className="page-header">
              <div><p className="eyebrow">Your machine</p><h1>Connections</h1><p>One service. Every account. No credential collisions.</p></div>
              <button className="button primary" onClick={() => setView("catalog")}><span>＋</span>Add connection</button>
            </header>

            {data.profiles.length > 0 && (
              <div className="toolbar">
                <div className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search accounts and projects" /></div>
                <span className="connection-count">{filteredProfiles.length} connection{filteredProfiles.length === 1 ? "" : "s"}</span>
              </div>
            )}

            {importableDetections.length > 0 && (
              <button className="discovery-banner" onClick={() => setView("detected")}>
                <span className="discovery-pulse">◎</span>
                <div><strong>{importableDetections.length} existing remote connection{importableDetections.length === 1 ? "" : "s"} can be imported</strong><small>Review what MMCP found in local client configurations.</small></div>
                <b>Review →</b>
              </button>
            )}

            {data.profiles.length === 0 ? (
              <section className="empty-state">
                <div className="empty-orbit"><span className="orb a" /><span className="orb b" /><span className="orb c" /><div className="empty-center">M</div></div>
                <h2>Connect your first account</h2>
                <p>Add separate personal, work, or client identities without changing the server you use.</p>
                <button className="button primary" onClick={() => setView("catalog")}>Browse services</button>
              </section>
            ) : (
              <div className="connections-list">
                {filteredProfiles.map((profile) => {
                  const service = serviceMap[profile.serviceId];
                  return (
                    <article className="connection-card" key={profile.id}>
                      <div className="connection-main">
                        {service && <Icon service={service} />}
                        <div className="connection-copy">
                          <div className="connection-title"><strong>{profile.serviceName}</strong><span>·</span><b>{profile.label}</b><Status profile={profile} /></div>
                          <p>{[profile.accountHint, profile.scope, profile.readOnly ? "Read-only" : "Read/write"].filter(Boolean).join(" · ") || profile.endpoint}</p>
                        </div>
                      </div>
                      <div className="connection-actions">
                        {profile.status === "connecting" ? (
                          <button className="button small danger-button" onClick={() => cancelConnection(profile)}>Cancel</button>
                        ) : (
                          <button className="button small" onClick={() => startConnection(profile)}>
                            {profile.authType === "oauth" ? "Connect" : "Test"}
                          </button>
                        )}
                        {service?.supportsReadOnly && <button className="button small ghost" onClick={() => openProfileEditor(profile)}>{profile.readOnly ? "Read-only · Change" : "Read/write · Change"}</button>}
                        <button className="button small ghost" onClick={() => setConfigProfile(profile)}>Install</button>
                        <button className="button small ghost" onClick={() => openProfileEditor(profile)}>Edit</button>
                      </div>
                      {(logs[profile.id]?.length || profile.lastError) && (
                        <div className="connection-log">
                          <div><span>Recent activity</span><button onClick={() => setLogs((previous) => ({ ...previous, [profile.id]: [] }))}>Clear</button></div>
                          <pre>{(logs[profile.id] || [profile.lastError]).join("\n")}</pre>
                          <button className="danger-link" onClick={() => removeProfile(profile)}>Remove connection</button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {view === "guide" && (
          <section className="guide-page">
            <header className="page-header compact-header">
              <div><p className="eyebrow">Plain-language setup</p><h1>How to connect an account</h1><p>Create one profile for each account and workspace you want an AI client to use.</p></div>
              <button className="button primary" onClick={() => setView("catalog")}><span>＋</span>Add account</button>
            </header>

            <div className="guide-rule"><span>1</span><div><strong>One profile = one account boundary</strong><p>For example: “GitHub · Work,” “GitHub · Personal,” and “Supabase · Client A” are separate profiles—even when they use the same MCP server.</p></div></div>

            <div className="guide-grid">
              <article className="guide-card">
                <div className="guide-card-heading"><span className="guide-route">A</span><div><p className="eyebrow">Already connected elsewhere</p><h2>Bring it in from this Mac</h2></div></div>
                <ol className="guide-steps">
                  <li><b>1</b><div><strong>Open Detected on Mac</strong><span>Review MCP servers found in your installed AI clients.</span></div></li>
                  <li><b>2</b><div><strong>Choose Import metadata</strong><span>The service and endpoint are copied, not the other app’s credential.</span></div></li>
                  <li><b>3</b><div><strong>Name and authenticate it</strong><span>Give it a clear account label, then sign in or enter a fresh scoped token.</span></div></li>
                </ol>
                <button className="text-button guide-action" onClick={() => setView("detected")}>Open Detected on Mac →</button>
              </article>

              <article className="guide-card">
                <div className="guide-card-heading"><span className="guide-route">B</span><div><p className="eyebrow">New server or account</p><h2>Set it up from scratch</h2></div></div>
                <ol className="guide-steps">
                  <li><b>1</b><div><strong>Pick a service</strong><span>Open Service catalog, or use Custom MCP for any compatible HTTP endpoint.</span></div></li>
                  <li><b>2</b><div><strong>Describe the boundary</strong><span>Enter a connection name, optional account hint, and project or organization scope.</span></div></li>
                  <li><b>3</b><div><strong>Choose authentication</strong><span>Use browser sign-in for OAuth, or add a narrowly scoped token stored with macOS encryption.</span></div></li>
                </ol>
                <button className="text-button guide-action" onClick={() => setView("catalog")}>Browse services →</button>
              </article>
            </div>

            <section className="guide-finish">
              <p className="eyebrow">Finish the connection</p>
              <h2>Connect, then install it in your AI client.</h2>
              <div className="finish-steps">
                <div><span>1</span><strong>Run Connect</strong><p>Complete the browser sign-in or test your token. OAuth data stays separate for this profile.</p></div>
                <div><span>2</span><strong>Click Install</strong><p>Choose Claude Desktop, Codex, Cursor, or Windsurf. MMCP makes a backup before changing a client file.</p></div>
                <div><span>3</span><strong>Restart the client</strong><p>Your AI client will see a distinct server name for this specific account profile.</p></div>
              </div>
            </section>

            <div className="notice guide-notice"><strong>What we do not import:</strong> OAuth sessions, browser cookies, Keychain values, and token values belonging to another app. That keeps each account profile secure and independent.</div>
          </section>
        )}

        {view === "detected" && (
          <>
            <header className="page-header compact-header">
              <div><p className="eyebrow">Read-only discovery</p><h1>Detected on this Mac</h1><p>Configured MCP servers found in supported local AI clients.</p></div>
              <button className="button" onClick={scanConnections}><span>↻</span>Scan again</button>
            </header>

            <div className="detection-summary">
              <div><strong>{data.discovery.connections.length}</strong><span>configured servers</span></div>
              <div><strong>{new Set(data.discovery.connections.map((connection) => connection.hostId)).size}</strong><span>clients with MCP</span></div>
              <div><strong>{data.discovery.connections.filter((connection) => connection.managedProfileId).length}</strong><span>already managed</span></div>
              <div><strong>{importableDetections.length}</strong><span>ready to import</span></div>
            </div>

            <div className="notice discovery-notice">
              Discovery reads known local configuration files only. It reports server names, endpoints, commands, and credential-field names—but never sends token values to the interface. Cloud-only connectors and account emails hidden inside another app’s OAuth store cannot be identified safely.
            </div>

            {data.discovery.connections.length === 0 ? (
              <section className="detected-empty"><span>◎</span><h2>No configured MCP servers found</h2><p>Add a connection manually or configure one in a supported client, then scan again.</p></section>
            ) : (
              <div className="detected-list">
                {data.discovery.connections.map((connection) => {
                  const service = serviceMap[connection.serviceId] || serviceMap.custom;
                  const subtitle = connection.endpoint || `${connection.command || "Local command"} · stdio`;
                  const connectionDetail = connection.scope || (!connection.endpoint ? "Local process" : "Account identity hidden by host");
                  return (
                    <article className="detected-card" key={connection.id}>
                      <Icon service={service} />
                      <div className="detected-copy">
                        <div><strong>{connection.serviceName || service.name}</strong><span>·</span><b>{connection.profileLabel}</b></div>
                        <p>{subtitle}</p>
                        <small>{connection.hostName} · {connectionDetail}</small>
                      </div>
                      <span className={`detection-badge detection-${connection.authState}`}>
                        {connection.managedProfileId ? "Managed" : connection.staleManagedProfile ? "Missing profile" : connection.authKind === "local" ? "Local server" : connection.authKind === "token" ? "Token configured" : "Host OAuth"}
                      </span>
                      {connection.importable ? (
                        <button className="button small" onClick={() => importDetection(connection)}>Import metadata</button>
                      ) : connection.managedProfileId ? (
                        <button className="button small ghost" onClick={() => { setQuery(connection.profileLabel); setView("connections"); }}>Open</button>
                      ) : (
                        <button className="button small ghost" disabled>Detected</button>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {data.discovery.warnings.length > 0 && (
              <details className="scan-warnings"><summary>{data.discovery.warnings.length} configuration warning{data.discovery.warnings.length === 1 ? "" : "s"}</summary>{data.discovery.warnings.map((warning) => <p key={warning.sourcePath}><strong>{warning.hostName}:</strong> {warning.message}</p>)}</details>
            )}
          </>
        )}

        {view === "catalog" && (
          <>
            <header className="page-header compact-header">
              <div><p className="eyebrow">Presets</p><h1>Service catalog</h1><p>Official remote servers first, custom adapters when needed.</p></div>
            </header>
            <div className="catalog-grid">
              {data.services.map((service) => (
                <button className="service-tile" key={service.id} onClick={() => { setEditingProfile(undefined); setDiscoverySeed(undefined); setAddingService(service); }}>
                  <div className="tile-top"><Icon service={service} size="large" /><span className={`maturity maturity-${service.maturity}`}>{maturityNames[service.maturity]}</span></div>
                  <strong>{service.name}</strong>
                  <p>{service.description}</p>
                  <div className="tile-foot"><span>{service.authModes.map((mode) => authNames[mode]).join(" · ")}</span><b>＋</b></div>
                </button>
              ))}
            </div>
          </>
        )}

        {view === "clients" && (
          <>
            <header className="page-header compact-header">
              <div><p className="eyebrow">Configuration</p><h1>AI clients</h1><p>Install a profile into a supported client with an automatic backup.</p></div>
            </header>
            <div className="client-list">
              {data.hosts.map((host) => (
                <div className="client-row" key={host.id}>
                  <div className="client-logo">{host.name.slice(0, 1)}</div>
                  <div className="client-copy"><strong>{host.name}</strong><span>{host.filePath}</span></div>
                  <span className={`status ${host.configured ? "status-connected" : "status-ready"}`}><i />{host.configured ? "Configuration found" : "Not configured"}</span>
                  <button className="button small ghost" onClick={() => host.configured ? window.mcpAccounts.openPath(host.filePath) : notify("Install a connection from its card to create this configuration.")}>Show</button>
                </div>
              ))}
            </div>
            <div className="notice client-notice">MMCP merges only its named server entry and creates a timestamped backup before changing an existing client configuration.</div>
          </>
        )}

        {view === "about" && (
          <section className="about-page">
            <img className="about-wordmark" src={fullWordmark} alt="MULTI MCP" />
            <p className="eyebrow">Local MCP profile manager</p>
            <h1>Accounts belong to people,<br />not server URLs.</h1>
            <p className="about-lede">MMCP creates a separate authentication boundary for every service profile on this Mac. OAuth state stays isolated. Static credentials are encrypted locally. Generated client configuration contains only a profile identifier.</p>
            <div className="about-grid">
              <div><strong>Secure by default</strong><p>Secrets are encrypted through Electron’s macOS secure storage integration and never copied into client JSON.</p></div>
              <div><strong>Visible routing</strong><p>Every profile gets a distinct name so an agent can’t silently confuse work, personal, and client accounts.</p></div>
              <div><strong>Local first</strong><p>No MMCP cloud, telemetry, or account registration is required for this MVP.</p></div>
            </div>
            <button className="text-button docs-link" onClick={() => window.mcpAccounts.openExternal("https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization")}>Read the MCP authorization specification ↗</button>
          </section>
        )}
      </main>

      {addingService && (
        <AddConnection
          service={addingService}
          profile={editingProfile}
          onClose={() => { setAddingService(undefined); setEditingProfile(undefined); setDiscoverySeed(undefined); }}
          initialInput={discoverySeed}
          onSaved={async () => {
            setAddingService(undefined);
            setEditingProfile(undefined);
            setDiscoverySeed(undefined);
            setView("connections");
            await refresh();
            notify("Connection saved. Run Connect to authenticate and discover tools.");
          }}
          onRemove={editingProfile ? () => removeProfile(editingProfile).then(() => { setAddingService(undefined); setEditingProfile(undefined); }) : undefined}
          onResetAuth={editingProfile?.authType === "oauth" ? () => resetProfileAuth(editingProfile) : undefined}
        />
      )}
      {configProfile && <ConfigSheet profile={configProfile} hosts={data.hosts} onClose={() => setConfigProfile(undefined)} notify={notify} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default App;
