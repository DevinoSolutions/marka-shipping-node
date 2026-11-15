import { describe, expect, it } from "vitest";
import { CanadaPostAuthError, type CanadaPostDebugEvent } from "../src/index.js";
import {
  FAKE_SERVICES,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  fakeToken,
  json,
  makeRestClient,
  tokenReply,
} from "./support/rest.js";

const services = json(FAKE_SERVICES);

async function listServices(h: ReturnType<typeof makeRestClient>): Promise<void> {
  await h.client.rating.listServices();
}

describe("OAuth token provider", () => {
  it("requests a client_credentials token with a form body and no Authorization header", async () => {
    const h = makeRestClient(services);
    await listServices(h);
    const [req] = h.tokenRequests();
    expect(req?.method).toBe("POST");
    expect(req?.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(req?.headers["accept"]).toBe("application/json");
    expect(req?.headers["authorization"]).toBeUndefined();
    const form = new URLSearchParams(req?.body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: TEST_CLIENT_ID,
      client_secret: TEST_CLIENT_SECRET,
      scope: "merchant",
    });
  });

  it("can request the platform scope", async () => {
    const h = makeRestClient(services, { overrides: { scope: "platform" } });
    await listServices(h);
    expect(new URLSearchParams(h.tokenRequests()[0]?.body).get("scope")).toBe("platform");
  });

  it("sends the issued token as a Bearer credential", async () => {
    const h = makeRestClient(services);
    await listServices(h);
    expect(h.apiRequests()[0]?.headers["authorization"]).toBe(`Bearer ${fakeToken(1)}`);
  });

  it("caches the token across calls", async () => {
    const h = makeRestClient(services);
    await listServices(h);
    await listServices(h);
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(1);
    expect(h.apiRequests()).toHaveLength(3);
  });

  it("refreshes 60 s before expiry and not a moment earlier", async () => {
    const h = makeRestClient(services); // expires_in: 3600
    await listServices(h);
    h.clock.now += 3600_000 - 60_000 - 1; // 1 ms before the refresh point
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(1);
    h.clock.now += 1; // exactly at the refresh point
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(2);
    expect(h.apiRequests()[2]?.headers["authorization"]).toBe(`Bearer ${fakeToken(2)}`);
  });

  it("honours a custom refresh skew", async () => {
    const h = makeRestClient(services, { overrides: { tokenRefreshSkewMs: 10_000 } });
    await listServices(h);
    h.clock.now += 3600_000 - 10_000;
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(2);
  });

  it("never refreshes later than halfway for a token shorter than the skew", async () => {
    const h = makeRestClient(services, { token: (n) => tokenReply(n, { expires_in: 30 }) });
    await listServices(h);
    h.clock.now += 14_999;
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(1);
    h.clock.now += 1;
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(2);
  });

  it("assumes 300 s when expires_in is missing", async () => {
    const h = makeRestClient(services, {
      token: (n) => json({ token_type: "Bearer", access_token: fakeToken(n) }),
    });
    await listServices(h);
    h.clock.now += 300_000 - 60_000 - 1;
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(1);
    h.clock.now += 1;
    await listServices(h);
    expect(h.tokenRequests()).toHaveLength(2);
  });

  it("shares ONE in-flight token request between concurrent callers", async () => {
    let release: () => void = () => undefined;
    const tokenGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = makeRestClient(services, { tokenGate });
    const calls = Array.from({ length: 6 }, () => h.client.rating.listServices());
    await new Promise((resolve) => setTimeout(resolve, 10)); // let every caller reach the gate
    expect(h.tokenFetchesStarted()).toBe(1);
    release();
    await Promise.all(calls);
    expect(h.tokenRequests()).toHaveLength(1);
    expect(h.apiRequests()).toHaveLength(6);
    expect(new Set(h.apiRequests().map((r) => r.headers["authorization"]))).toEqual(
      new Set([`Bearer ${fakeToken(1)}`]),
    );
  });

  it("shares ONE refresh between concurrent callers when the token has expired", async () => {
    const h = makeRestClient(services);
    await listServices(h);
    h.clock.now += 3600_000;
    await Promise.all(Array.from({ length: 4 }, () => h.client.rating.listServices()));
    expect(h.tokenRequests()).toHaveLength(2);
  });

  it("a failed single-flight refresh rejects every waiter and the next call tries again", async () => {
    const h = makeRestClient(services, {
      token: (n) => (n === 1 ? json({ error: "unauthorized_client" }, 401) : tokenReply(n)),
    });
    const results = await Promise.allSettled([
      h.client.rating.listServices(),
      h.client.rating.listServices(),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(h.tokenRequests()).toHaveLength(1);
    await expect(h.client.rating.listServices()).resolves.toBeDefined();
    expect(h.tokenRequests()).toHaveLength(2);
  });

  describe("token endpoint failures", () => {
    it("does not retry rejected credentials (401) and reports the OAuth error", async () => {
      const h = makeRestClient(services, {
        token: () =>
          json(
            {
              error: "unauthorized_client",
              error_description:
                "Invalid client ID or secret, or client not subscribed to this API",
            },
            401,
          ),
      });
      const error = await h.client.rating.listServices().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CanadaPostAuthError);
      const auth = error as CanadaPostAuthError;
      expect(auth.status).toBe(401);
      expect(auth.oauthError).toBe("unauthorized_client");
      expect(auth.transient).toBe(false);
      expect(auth.message).toContain("Invalid client ID or secret");
      expect(h.tokenRequests()).toHaveLength(1);
      expect(h.apiRequests()).toHaveLength(0);
    });

    it.each([400, 403])("does not retry HTTP %i", async (status) => {
      const h = makeRestClient(services, {
        token: () => json({ error: "invalid_request" }, status),
      });
      await expect(h.client.rating.listServices()).rejects.toMatchObject({
        status,
        transient: false,
      });
      expect(h.tokenRequests()).toHaveLength(1);
    });

    it.each([500, 502, 503, 504, 429])("retries HTTP %i then succeeds", async (status) => {
      const h = makeRestClient(services, {
        token: (n) => (n < 3 ? json({ error: "temporarily_unavailable" }, status) : tokenReply(n)),
      });
      await listServices(h);
      expect(h.tokenRequests()).toHaveLength(3);
      expect(h.apiRequests()[0]?.headers["authorization"]).toBe(`Bearer ${fakeToken(3)}`);
    });

    it("gives up after retries + 1 attempts with a transient error", async () => {
      const h = makeRestClient(services, { token: () => json({}, 503) });
      const error = await h.client.rating.listServices().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CanadaPostAuthError);
      expect((error as CanadaPostAuthError).transient).toBe(true);
      expect((error as CanadaPostAuthError).status).toBe(503);
      expect(h.tokenRequests()).toHaveLength(3); // retries: 2 -> 3 attempts
    });

    it("honours the configured number of retries", async () => {
      const h = makeRestClient(services, { token: () => json({}, 503), overrides: { retries: 0 } });
      await expect(h.client.rating.listServices()).rejects.toBeInstanceOf(CanadaPostAuthError);
      expect(h.tokenRequests()).toHaveLength(1);
    });

    it("retries a network failure", async () => {
      const h = makeRestClient(services, {
        token: (n) => (n === 1 ? { error: new TypeError("fetch failed") } : tokenReply(n)),
      });
      await listServices(h);
      expect(h.tokenRequests()).toHaveLength(2);
    });

    it("turns a persistent network failure into a transient auth error", async () => {
      const h = makeRestClient(services, {
        token: () => ({ error: new TypeError("fetch failed") }),
      });
      const error = await h.client.rating.listServices().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CanadaPostAuthError);
      expect((error as CanadaPostAuthError).transient).toBe(true);
      expect((error as CanadaPostAuthError).status).toBeUndefined();
    });

    it("times out a hung token request and retries it", async () => {
      const h = makeRestClient(services, {
        token: (n) => (n === 1 ? { hang: true } : tokenReply(n)),
        overrides: { timeoutMs: 20 },
      });
      await listServices(h);
      expect(h.tokenRequests()).toHaveLength(2);
    });

    it("reports a persistent token timeout as transient", async () => {
      const h = makeRestClient(services, {
        token: () => ({ hang: true }),
        overrides: { timeoutMs: 10, retries: 1 },
      });
      const error = await h.client.rating.listServices().catch((e: unknown) => e);
      expect((error as CanadaPostAuthError).transient).toBe(true);
      expect((error as CanadaPostAuthError).message).toMatch(/timed out/);
    });

    it("does not retry malformed token responses", async () => {
      for (const reply of [
        { status: 200, body: "not json" },
        json({ token_type: "Bearer" }),
        json({ token_type: "Bearer", access_token: "" }),
        json({ token_type: "MAC", access_token: "x" }),
      ]) {
        const h = makeRestClient(services, { token: () => reply });
        await expect(h.client.rating.listServices()).rejects.toBeInstanceOf(CanadaPostAuthError);
        expect(h.tokenRequests()).toHaveLength(1);
      }
    });
  });

  describe("secrets never leak", () => {
    const secretsIn = (text: string): string[] =>
      [TEST_CLIENT_SECRET, fakeToken(1), fakeToken(2)].filter((s) => text.includes(s));

    it("keeps the client secret out of token errors, even when the endpoint echoes it", async () => {
      const h = makeRestClient(services, {
        token: () =>
          json(
            {
              error: "invalid_client",
              error_description: `bad secret ${TEST_CLIENT_SECRET} for ${TEST_CLIENT_ID}`,
            },
            401,
          ),
      });
      const error = (await h.client.rating.listServices().catch((e: unknown) => e)) as Error;
      expect(secretsIn(error.message)).toEqual([]);
      expect(secretsIn(JSON.stringify(error, Object.getOwnPropertyNames(error)))).toEqual([]);
      expect(error.message).toContain("[REDACTED]");
    });

    it("does not echo an unparseable token body (it would hold the token)", async () => {
      const h = makeRestClient(services, {
        token: () => ({ status: 200, body: `{"access_token": "${fakeToken(1)}" oops` }),
      });
      const error = (await h.client.rating.listServices().catch((e: unknown) => e)) as Error;
      expect(secretsIn(error.message)).toEqual([]);
      expect(secretsIn(String((error as { cause?: unknown }).cause ?? ""))).toEqual([]);
    });

    it("keeps the token out of API errors, even when the API echoes it back", async () => {
      const h = makeRestClient(
        json({ title: "Bad", detail: `token ${fakeToken(1)} refused`, errors: [] }, 400),
      );
      const error = (await h.client.rating.listServices().catch((e: unknown) => e)) as Error & {
        bodyExcerpt?: string;
        detail?: string;
      };
      expect(secretsIn(error.message)).toEqual([]);
      expect(secretsIn(error.bodyExcerpt ?? "")).toEqual([]);
      expect(secretsIn(error.detail ?? "")).toEqual([]);
    });

    it("never gives the debug hook credentials, tokens or the form body", async () => {
      const events: CanadaPostDebugEvent[] = [];
      const h = makeRestClient(services, {
        overrides: {
          onDebug: (e) => {
            events.push(e);
          },
        },
      });
      await listServices(h);
      expect(events.some((e) => e.operation === "oauth.token")).toBe(true);
      const dump = JSON.stringify(events);
      expect(secretsIn(dump)).toEqual([]);
      expect(dump).not.toContain(TEST_CLIENT_ID);
      const api = events.find((e) => e.operation === "rating.listServices");
      expect(api?.headers["Authorization"]).toBe("[REDACTED]");
    });

    it("survives a throwing debug hook", async () => {
      const h = makeRestClient(services, {
        overrides: {
          onDebug: () => {
            throw new Error("logger down");
          },
        },
      });
      await expect(h.client.rating.listServices()).resolves.toBeDefined();
    });
  });
});
