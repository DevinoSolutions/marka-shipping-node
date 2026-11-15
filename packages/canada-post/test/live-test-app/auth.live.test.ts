// LIVE TEST-APP suite: authentication and the Test-app interlock.
//
// Runs only with CANADAPOST_TEST_APP_LIVE=true. `assertTestApp()` in beforeAll is mandatory
// (enforced by `npm run check:live-readonly`).
import { beforeAll, describe, expect, it } from "vitest";
import { CanadaPostAuthError, type CanadaPostDebugEvent } from "../../src/index.js";
import {
  clientWithWrongSecret,
  liveEnabled,
  observedTestAppClient,
  realClientSecret,
  testAppClient,
} from "./setup.js";

describe.skipIf(!liveEnabled)("Canada Post Test app: authentication", () => {
  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("is declared a Test app and probes as one with identical stub fingerprints", async () => {
    const client = testAppClient();
    expect(client.app).toBe("test");
    const probe = await client.probeTestApp();
    expect(probe.isTestApp).toBe(true);
    expect(probe.fingerprints).toHaveLength(2);
    expect(probe.fingerprints[0]).toBe(probe.fingerprints[1]);
    expect(probe.fingerprints[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issues one token and reuses it for later calls", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const observed = observedTestAppClient((e) => events.push(e));
    await observed.rating.listServices();
    await observed.rating.getOption("DC");
    const tokenRequests = events.filter(
      (e) => e.operation === "oauth.token" && e.type === "request",
    );
    expect(tokenRequests).toHaveLength(1);
    expect(
      events.filter((e) => e.operation === "rating.getOption" && e.type === "response"),
    ).toHaveLength(1);
    // Debug events never carry the credentials.
    const dump = JSON.stringify(events);
    expect(dump).not.toContain(realClientSecret());
  });

  it("rejects a wrong client secret with a typed, non-transient error and does not retry it", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const { client, secret } = clientWithWrongSecret((e) => events.push(e));
    const error = await client.rating.listServices().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostAuthError);
    const auth = error as CanadaPostAuthError;
    expect([400, 401]).toContain(auth.status);
    expect(auth.transient).toBe(false);
    expect(auth.message).not.toContain(secret);
    expect(JSON.stringify(auth, Object.getOwnPropertyNames(auth))).not.toContain(secret);
    expect(
      events.filter((e) => e.operation === "oauth.token" && e.type === "request"),
    ).toHaveLength(1);
    // Nothing was sent to the API with a bad token.
    expect(events.filter((e) => e.operation === "rating.listServices")).toHaveLength(0);
  });

  it("a wrong secret also stops a write before anything is sent", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const { client } = clientWithWrongSecret((e) => events.push(e));
    const error = await client.shipments.void("100000000000000001").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostAuthError);
    expect(events.filter((e) => e.operation === "shipments.void")).toHaveLength(0);
  });
});
