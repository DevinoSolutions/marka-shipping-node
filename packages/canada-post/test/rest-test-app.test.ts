import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanadaPostTestAppRequiredError,
  createCanadaPostRestClient,
  type RestPriceRequest,
} from "../src/index.js";
import {
  FAKE_QUOTES,
  RATING,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  TEST_CUSTOMER,
  bodyOf,
  json,
  makeRestClient,
} from "./support/rest.js";

const stub = json(FAKE_QUOTES);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("probeTestApp / assertTestApp", () => {
  it("proves a Test app when two very different quotes get byte-identical answers", async () => {
    const h = makeRestClient(stub);
    const result = await h.client.probeTestApp();
    expect(result.isTestApp).toBe(true);
    expect(result.reason).toBeUndefined();
    const digest = sha256(JSON.stringify(FAKE_QUOTES));
    expect(result.fingerprints).toEqual([digest, digest]);
    await expect(h.client.assertTestApp()).resolves.toBeUndefined();
  });

  it("sends two quotes that differ in origin, destination, weight, dimensions and services", async () => {
    const h = makeRestClient(stub);
    await h.client.assertTestApp();
    const [a, b] = h.apiRequests().map((r) => bodyOf(r) as RestPriceRequest);
    expect(h.apiRequests().map((r) => [r.method, r.url])).toEqual([
      ["POST", `${RATING}/prices`],
      ["POST", `${RATING}/prices`],
    ]);
    expect(a?.originPostalCode).not.toBe(b?.originPostalCode);
    expect(a?.destination).not.toEqual(b?.destination);
    expect(a?.parcelCharacteristics.weight).not.toBe(b?.parcelCharacteristics.weight);
    expect(a?.parcelCharacteristics.dimensions).not.toEqual(b?.parcelCharacteristics.dimensions);
    expect(a?.services).not.toEqual(b?.services);
  });

  it("only ever quotes: no write is sent", async () => {
    const h = makeRestClient(stub);
    await h.client.assertTestApp();
    expect(
      h.apiRequests().every((r) => r.method === "POST" && r.url.endsWith("/rating/v1/prices")),
    ).toBe(true);
  });

  it("refuses when the two quotes are priced differently (a real app computes rates)", async () => {
    const other = [
      { ...FAKE_QUOTES[0], priceDetails: { ...FAKE_QUOTES[0]?.priceDetails, due: 99 } },
    ];
    const h = makeRestClient((r) =>
      json(
        (bodyOf(r) as RestPriceRequest).parcelCharacteristics.weight === 0.4 ? FAKE_QUOTES : other,
      ),
    );
    const result = await h.client.probeTestApp();
    expect(result).toMatchObject({
      isTestApp: false,
      reason: "responses-differ",
      fingerprints: [],
    });
    const error = (await h.client
      .assertTestApp()
      .catch((e: unknown) => e)) as CanadaPostTestAppRequiredError;
    expect(error).toBeInstanceOf(CanadaPostTestAppRequiredError);
    expect(error.reason).toBe("responses-differ");
    expect(error.message).toMatch(/^Not a Test app, refusing/);
  });

  it("refuses when a byte differs, however small", async () => {
    const h = makeRestClient((_r, i) => ({
      status: 200,
      body: JSON.stringify(FAKE_QUOTES) + (i === 0 ? "" : " "),
      headers: { "content-type": "application/json" },
    }));
    await expect(h.client.assertTestApp()).rejects.toMatchObject({ reason: "responses-differ" });
  });

  it("refuses when quoting fails (an unlinked Production app answers 403 with no body)", async () => {
    const h = makeRestClient({ status: 403, body: "" });
    const result = await h.client.probeTestApp();
    expect(result).toMatchObject({ isTestApp: false, reason: "probe-failed" });
    await expect(h.client.assertTestApp()).rejects.toMatchObject({ reason: "probe-failed" });
  });

  it("refuses on token failures, network errors and timeouts", async () => {
    const badToken = makeRestClient(stub, {
      token: () => json({ error: "unauthorized_client" }, 401),
    });
    await expect(badToken.client.assertTestApp()).rejects.toMatchObject({ reason: "probe-failed" });
    const net = makeRestClient({ error: new TypeError("fetch failed") });
    await expect(net.client.assertTestApp()).rejects.toMatchObject({ reason: "probe-failed" });
    const hang = makeRestClient({ hang: true }, { overrides: { timeoutMs: 15 } });
    await expect(hang.client.assertTestApp()).rejects.toMatchObject({ reason: "probe-failed" });
  });

  it("does NOT accept two identical error answers as proof", async () => {
    for (const reply of [
      json({ errorCode: "400" }, 400),
      { status: 500, body: "same" },
      { status: 403, body: "" },
    ]) {
      const h = makeRestClient(reply);
      const result = await h.client.probeTestApp();
      expect(result.isTestApp).toBe(false);
    }
  });

  it("does NOT accept two identical empty or non-price answers as proof", async () => {
    for (const reply of [
      json([]),
      json({}),
      json("ok"),
      json([{ noServiceCode: true }]),
      json(null),
      { status: 200, body: "<html>same page</html>" },
      { status: 200, body: "" },
    ]) {
      const h = makeRestClient(reply);
      const result = await h.client.probeTestApp();
      expect(result.isTestApp, JSON.stringify(reply)).toBe(false);
      expect(result.reason).toBe("unexpected-response");
    }
  });

  it("a non-200 success status is not a price list", async () => {
    const h = makeRestClient({ status: 202, body: JSON.stringify(FAKE_QUOTES) });
    await expect(h.client.assertTestApp()).rejects.toMatchObject({ reason: "unexpected-response" });
  });

  it("a client declared production refuses without sending anything", async () => {
    const h = makeRestClient(stub, { overrides: { app: "production" } });
    expect(h.client.app).toBe("production");
    const result = await h.client.probeTestApp();
    expect(result).toMatchObject({ isTestApp: false, reason: "declared-production" });
    await expect(h.client.assertTestApp()).rejects.toMatchObject({ reason: "declared-production" });
    expect(h.mock.requests).toHaveLength(0);
  });

  it("never leaks credentials through its errors", async () => {
    const h = makeRestClient(json({ detail: TEST_CLIENT_SECRET }, 400));
    const error = (await h.client.assertTestApp().catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(TEST_CLIENT_SECRET);
    expect(String((error as { cause?: Error }).cause?.message ?? "")).not.toContain(
      TEST_CLIENT_SECRET,
    );
  });
});

describe("app declaration", () => {
  const opts = {
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    customerNumber: TEST_CUSTOMER,
    fetch: makeRestClient(stub).mock.fetch,
  };

  it("defaults to test", () => {
    expect(createCanadaPostRestClient(opts).app).toBe("test");
  });

  it("is never read from the environment", () => {
    const keys = ["CANADAPOST_APP", "CANADAPOST_APP_TYPE", "CANADAPOST_ENVIRONMENT", "APP"];
    const saved = keys.map((k) => [k, process.env[k]] as const);
    try {
      for (const k of keys) process.env[k] = "production";
      expect(createCanadaPostRestClient(opts).app).toBe("test");
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("accepts only test or production", () => {
    expect(createCanadaPostRestClient({ ...opts, app: "production" }).app).toBe("production");
    expect(() => createCanadaPostRestClient({ ...opts, app: "sandbox" as never })).toThrow(
      /app must be/,
    );
  });
});
