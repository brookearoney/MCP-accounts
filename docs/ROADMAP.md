# MVP and public-beta roadmap

## Personal MVP

- [x] Connection profile catalog
- [x] Multiple profiles per service
- [x] Per-profile OAuth directories
- [x] Encrypted static credential storage
- [x] Profile-specific bridge mode
- [x] Connection test and OAuth launch
- [x] Claude Desktop configuration adapter
- [x] Cursor configuration adapter
- [x] Windsurf configuration adapter
- [x] Automatic configuration backups
- [x] Supabase project/read-only URL builder
- [x] Linear read-only endpoint
- [x] Sentry organization/project scope
- [x] Read-only discovery across popular local MCP clients
- [x] Secret-safe metadata import from existing remote MCP configuration
- [ ] Live smoke test with two Supabase accounts
- [ ] Live smoke test with two GitHub accounts
- [ ] Verify Vercel client approval behavior
- [ ] Confirm supported Higgsfield API or MCP route
- [ ] Build first-party Framer Server API adapter

## Public beta

- Bundle a pinned, audited MCP bridge instead of invoking `npx`.
- Add a Codex host configuration adapter.
- Add VS Code and Raycast host adapters.
- Add host-entry removal and rename reconciliation.
- Add OAuth registration recovery when cached client metadata becomes stale.
- Add explicit permission and scope review before installation.
- Add profile colors and a mandatory destructive-tool confirmation policy.
- Add richer migration for provider-specific scopes and aliases.
- Add credential revocation links and secure OAuth reset.
- Sign, harden, and notarize the application.
- Add an opt-in update channel with signed releases.
- Complete an external security review.
- Publish a provider compatibility matrix.

## Provider adapters

- Framer Server API adapter with project-bound API keys.
- Higgsfield adapter, conditional on an official supported API surface.
- Local GitHub MCP Server launcher for users who prefer GitHub's official binary or Docker image.
- Local Supabase CLI transport for development environments.
