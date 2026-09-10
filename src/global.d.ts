import type { MCPAccountsApi } from "./types";

declare global {
  interface Window {
    mcpAccounts: MCPAccountsApi;
  }
}

export {};
