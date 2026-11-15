import { defineConfig } from "vitest/config";

// Live suite against the Canada Post Developer Portal TEST app (free, static stub answers).
// Gated inside the suite on CANADAPOST_TEST_APP_LIVE=true (credentials missing while the flag
// is set FAILS the run) and never part of the default `npm test`. Unlike test/live/, it may
// create and void shipments, but only after `assertTestApp()` proved a Test app in beforeAll;
// scripts/check-live-readonly.ts enforces that, and bans every reference to production.
export default defineConfig({
  test: {
    name: "sdk-live-test-app",
    environment: "node",
    include: ["test/live-test-app/**/*.live.test.ts"],
    root: import.meta.dirname,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One file at a time: the suites share one app and its rate limit.
    fileParallelism: false,
  },
});
