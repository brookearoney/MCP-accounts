const test = require("node:test");
const assert = require("node:assert/strict");
const { services } = require("../electron/services.cjs");

test("Higgsfield uses the official OAuth MCP endpoint", () => {
  const higgsfield = services.find((service) => service.id === "higgsfield");
  assert.deepEqual(higgsfield.authModes, ["oauth"]);
  assert.equal(higgsfield.endpoint, "https://mcp.higgsfield.ai/mcp");
  assert.equal(higgsfield.endpointLocked, true);
  assert.equal(higgsfield.maturity, "official");
});

test("new hosted OAuth services use their official locked endpoints", () => {
  const byId = Object.fromEntries(services.map((service) => [service.id, service]));
  assert.equal(byId.posthog.endpoint, "https://mcp.posthog.com/mcp");
  assert.equal(byId.neon.endpoint, "https://mcp.neon.tech/mcp");
  assert.equal(byId.notion.endpoint, "https://mcp.notion.com/mcp");
  assert.equal(byId.posthog.endpointLocked, true);
  assert.equal(byId.neon.endpointLocked, true);
  assert.equal(byId.notion.endpointLocked, true);
  assert.deepEqual(byId.posthog.authModes, ["oauth"]);
});

test("HubSpot and Slack require a local OAuth client while Shopify is UCP-guided", () => {
  const byId = Object.fromEntries(services.map((service) => [service.id, service]));
  assert.equal(byId.hubspot.requiresOAuthClient, true);
  assert.equal(byId.hubspot.oauthCallbackPort, 7260);
  assert.equal(byId.slack.requiresOAuthClient, true);
  assert.equal(byId.slack.oauthCallbackPort, 48125);
  assert.equal(byId.shopify.requiresUcpProfile, true);
});
