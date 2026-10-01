import { defineConfig } from 'vitest/config';

// No DOM here on purpose: this package must run in plain Node (the MCP server's environment).
export default defineConfig({
  test: { environment: 'node', globals: true },
});
