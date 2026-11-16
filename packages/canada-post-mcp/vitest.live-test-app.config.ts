import { defineConfig } from "vitest/config";

// Live smoke suite of the MCP server against the Canada Post Developer Portal TEST app (free,
// static stub answers). Gated inside the suite on CANADAPOST_TEST_APP_LIVE=true (credentials
// missing while the flag is set FAILS the run) and never part of the default `npm test`. It
// may create and void shipments, but only after `assertTestApp()` proved a Test app in
// beforeAll; scripts/check-live-readonly.ts enforces that, and bans every reference to
// production.
export default defineConfig({
  test: {
    name: "mcp-live-test-app",
    environment: "node",
    include: ["test/live-test-app/**/*.live.test.ts"],
    root: import.meta.dirname,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
