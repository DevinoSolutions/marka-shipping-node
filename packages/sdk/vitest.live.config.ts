import { defineConfig } from "vitest/config";

// Opt-in live smoke tests against the REAL Canada Post sandbox account.
// Gated inside the suite on CANADAPOST_LIVE_TESTS plus credentials, and refuses any non-development environment; never included in the
// default `npm test` run and never in CI. The suite is READ-ONLY — see
// scripts/check-live-readonly.ts, which fails the build if a mutating call appears here.
export default defineConfig({
  test: {
    name: "sdk-live",
    environment: "node",
    include: ["test/live/**/*.live.test.ts"],
    root: import.meta.dirname,
    testTimeout: 120_000,
  },
});
