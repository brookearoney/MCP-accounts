# MCP Accounts

MCP Accounts is a local-first macOS utility for connecting more than one identity to the same MCP service. It creates one explicit, isolated profile for every personal, work, client, project, or workspace connection.

The MVP includes:

- A native-feeling Electron interface for connection profiles.
- A left-panel “How to connect” guide that walks through imported and new account setup.
- Presets for Supabase, GitHub, Vercel, Higgsfield, Framer, Linear, Sentry, Stripe, Cloudflare, Atlassian, and custom servers.
- Profile-specific OAuth storage via `MCP_REMOTE_CONFIG_DIR`.
- Encrypted local storage for PATs and API tokens through Electron `safeStorage` on macOS.
- A bridge mode that keeps credentials out of generated MCP client configuration.
- One-click configuration installation for Claude Desktop, Codex, Cursor, and Windsurf.
- Read-only discovery of configured MCP servers in Claude Desktop, Claude Code, Codex, Cursor, Windsurf, VS Code, and Zed.
- Metadata-only import for existing remote servers, with managed profiles recognized automatically.
- Timestamped backups before existing host configuration is changed.
- Redacted connection diagnostics.

## Run it

Requirements: macOS, Node.js 20 or newer, and npm.

```bash
npm install
npm run dev
```

Run checks:

```bash
npm test
npm run build
```

Create an unpacked Mac application:

```bash
npm run package:mac
```

Create a DMG:

```bash
npm run dist:mac
```

Unsigned development builds may show the normal macOS security warning. Public distribution requires an Apple Developer signing identity and notarization configuration.

## How the bridge works

Installed client configuration contains a command like:

```json
{
  "mcpServers": {
    "supabase_work_ab12": {
      "command": "/Applications/MCP Accounts.app/Contents/MacOS/MCP Accounts",
      "args": ["--mcp-profile", "ab12…"]
    }
  }
}
```

When an MCP host starts that command, MCP Accounts runs without its UI, opens the profile metadata, decrypts the selected credential if needed, and launches an isolated `mcp-remote` bridge. OAuth state lives under a directory unique to that profile.

Static credentials are supplied to the bridge through the child process environment and referenced symbolically by the MCP proxy argument. They are not written into host configuration.

## Current boundaries

- The MVP targets remote Streamable HTTP MCP endpoints.
- Discovery reads known local configuration files. It can identify a provider, endpoint, project scope, and whether credential fields are configured, but it does not copy credential values.
- Third-party clients commonly keep OAuth account identity and tokens in private stores. MCP Accounts therefore cannot safely infer an email address or reuse that authorization; imported metadata must be authenticated as a new isolated profile.
- It uses `npx mcp-remote@latest`, so Node/npm and network access are required on first bridge launch.
- Framer and Higgsfield are adapter slots until a compatible MCP endpoint is supplied.
- Vercel only accepts reviewed MCP clients, so its behavior through the bridge must be validated.
- GitHub PAT authentication is the most predictable personal-MVP path. OAuth through the remote GitHub server may require a registered GitHub App or OAuth App.
- Deleting a profile removes its local encrypted credential and OAuth directory, plus matching MCP Accounts entries in Claude Desktop, Codex, Cursor, and Windsurf (with backups). It does not remove manually exported configuration or revoke provider-side grants.

See [docs/ROADMAP.md](docs/ROADMAP.md) for the public-beta work.
