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
