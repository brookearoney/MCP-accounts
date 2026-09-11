# Security model

MCP Accounts is local-first. The MVP has no cloud service, account registration, analytics, or telemetry.

## Credential handling

- Static secrets are encrypted using Electron `safeStorage`, which uses platform-provided encryption on macOS.
- Renderer processes never receive encrypted or decrypted credentials after save.
- Generated client configurations contain profile identifiers, not credentials.
- Decrypted values are passed only to the isolated bridge child process environment.
- Diagnostic output is redacted before it is sent to the renderer.
- Profile metadata and OAuth directories are created with owner-only permissions where supported.

## Local discovery

Discovery is read-only and limited to known MCP client configuration paths. The scanner exposes server names, sanitized endpoints, local command basenames, project scope, and credential-field names to the renderer. It does not return environment values or header values. URL user information is removed and secret-like query parameters are redacted.

MCP Accounts does not inspect another client's browser cookies, Keychain entries, OAuth token cache, or cloud account. A detected server can be imported as metadata, but it must be authenticated separately before MCP Accounts can manage it.

## OAuth isolation

Every profile receives a unique OAuth configuration directory. A token or dynamic client registration cached for one account cannot overwrite another profile's state simply because both profiles use the same MCP endpoint.

## Known MVP risks

- The bridge currently downloads or resolves `mcp-remote@latest` through npm. Public builds should bundle a pinned and audited bridge binary.
- A user with access to the logged-in macOS account and running process inspection tools may be able to inspect child-process environments.
- Upstream MCP servers and connected AI hosts remain separate trust boundaries.
- Provider-specific OAuth implementations may reject proxy clients or impose additional account and organization policies.
- Deleting a profile does not yet revoke provider-side OAuth grants or remove already-exported third-party configuration.
- Client configuration formats can evolve; unsupported or malformed files are skipped and surfaced as a local warning.

Do not connect production databases or high-value write credentials during initial testing. Use narrowly scoped or read-only profiles whenever the provider supports them.
