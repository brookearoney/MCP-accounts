export type AuthType = "oauth" | "pat" | "apiKey" | "apiToken" | "bearer";
export type Maturity = "official" | "restricted" | "adapter" | "custom";

export interface ServiceDefinition {
  id: string;
  name: string;
  monogram: string;
  color: string;
  endpoint: string;
  authModes: AuthType[];
  maturity: Maturity;
  description: string;
  scopeLabel: string;
  supportsReadOnly?: boolean;
}

export interface Profile {
  id: string;
  serviceId: string;
  serviceName: string;
  label: string;
  accountHint: string;
  scope: string;
  endpoint: string;
  authType: AuthType;
  headerName: string;
  headerPrefix: string;
  readOnly: boolean;
  features: string;
  status: "ready" | "connecting" | "connected" | "error";
  lastError: string;
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HostDefinition {
  id: string;
  name: string;
  filePath: string;
  configured: boolean;
}

export interface BootstrapData {
  services: ServiceDefinition[];
  profiles: Profile[];
  discovery: DiscoveryResult;
  hosts: HostDefinition[];
  runtime: {
    packaged: boolean;
    encryptionAvailable: boolean;
    npx: string;
  };
}

export interface DetectedConnection {
  id: string;
  hostId: string;
  hostName: string;
  serverName: string;
  serviceId: string;
  serviceName: string;
  endpoint: string;
  command: string;
  scope: string;
  accountHint: string;
  profileLabel: string;
  managedProfileId: string;
  staleManagedProfile: boolean;
  authKind: "managed" | "token" | "oauth" | "local";
  authState: "managed" | "stale" | "configured" | "host-managed" | "local";
  suggestedAuthType: AuthType;
  importable: boolean;
  sourcePath: string;
  environmentKeys: string[];
  headerKeys: string[];
}

export interface DiscoveryWarning {
  hostName: string;
  sourcePath: string;
  message: string;
}

export interface DiscoveryResult {
  scannedAt: string;
  connections: DetectedConnection[];
  warnings: DiscoveryWarning[];
  scannedHosts: { id: string; name: string; sourcePath: string }[];
}

export interface ProfileInput {
  id?: string;
  serviceId: string;
  label: string;
  accountHint: string;
  scope: string;
  endpoint: string;
  authType: AuthType;
  secret: string;
  headerName: string;
  headerPrefix: string;
  readOnly: boolean;
  features: string;
}

export interface ConnectionEvent {
  profileId: string;
  kind: "output" | "complete" | "error";
  message: string;
}

export interface MCPAccountsApi {
  bootstrap: () => Promise<BootstrapData>;
  scanConnections: () => Promise<DiscoveryResult>;
  saveProfile: (input: ProfileInput) => Promise<Profile>;
  removeProfile: (id: string) => Promise<{ removed: boolean; installationsRemoved: number; warnings: string[] }>;
  resetProfileAuth: (id: string) => Promise<Profile>;
  getConfig: (id: string) => Promise<{ name: string; config: object }>;
  exportConfig: (id: string) => Promise<{ canceled: boolean; filePath?: string }>;
  installHost: (hostId: string, profileId: string) => Promise<{ filePath: string; backupPath: string; serverName: string }>;
  startConnection: (id: string) => Promise<{ started: boolean; reason?: string }>;
  cancelConnection: (id: string) => Promise<boolean>;
  openPath: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  onConnectionEvent: (callback: (event: ConnectionEvent) => void) => () => void;
}
