import { describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  CanadaPostConfigurationError,
  CanadaPostError,
  CanadaPostNetworkError,
  CanadaPostTimeoutError,
  createCanadaPostClient,
  MEDIA_TYPES,
  redactHeaders,
  type CanadaPostDebugEvent,
} from "../src/index.js";
import {
  ERROR_ONE_MESSAGE,
  ERROR_TWO_MESSAGES,
  RATES_RESPONSE,
  TRACKING_SUMMARY_RESPONSE,
} from "./fixtures.js";
import { expectedBasic, first, makeClient, TEST_CUSTOMER, TEST_PASSWORD, xml } from "./helpers.js";

const RATE_INPUT = {
  originPostalCode: "K2B8J6",
  destination: { type: "domestic", postalCode: "J0E1X0" },
  parcel: { weightKg: 1 },
} as const;

describe("environment", () => {
  it("defaults to the sandbox host", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    expect(client.environment).toBe("development");
    expect(client.baseUrl).toBe("https://ct.soa-gw.canadapost.ca");
    await client.rating.getRates(RATE_INPUT);
    expect(first(mock).url.startsWith("https://ct.soa-gw.canadapost.ca/")).toBe(true);
  });

  it("uses the production host only when asked explicitly", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating), {
      environment: "production",
    });
    expect(client.environment).toBe("production");
    await client.rating.getRates(RATE_INPUT);
    expect(first(mock).url).toBe("https://soa-gw.canadapost.ca/rs/ship/price");
  });

  it("rejects an unknown environment", () => {
    expect(() =>
      createCanadaPostClient({
        username: "u",
        password: "p",
        customerNumber: TEST_CUSTOMER,
        environment: "staging" as never,
      }),
    ).toThrow(CanadaPostConfigurationError);
  });

  it("validates required configuration without echoing the password", () => {
    const attempt = (): unknown =>
      createCanadaPostClient({ username: "", password: TEST_PASSWORD, customerNumber: "12" });
    expect(attempt).toThrow(CanadaPostConfigurationError);
    try {
      attempt();
    } catch (err) {
      expect(String(err)).not.toContain(TEST_PASSWORD);
    }
    expect(() =>
      createCanadaPostClient({ username: "u", password: "p", customerNumber: "abc" }),
    ).toThrow(/customerNumber/);
    expect(() =>
      createCanadaPostClient({ username: "a:b", password: "p", customerNumber: "1" }),
    ).toThrow(/colon/);
  });
});

describe("request headers", () => {
  it("sends Basic auth, versioned media types and Accept-Language", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    await client.rating.getRates(RATE_INPUT);
    const req = first(mock);
    expect(req.method).toBe("POST");
    expect(req.headers["authorization"]).toBe(expectedBasic());
    expect(req.headers["accept"]).toBe("application/vnd.cpc.ship.rate-v4+xml");
    expect(req.headers["content-type"]).toBe("application/vnd.cpc.ship.rate-v4+xml");
    expect(req.headers["accept-language"]).toBe("en-CA");
  });

  it("supports French error messages", async () => {
    const { client, mock } = makeClient(xml(TRACKING_SUMMARY_RESPONSE, MEDIA_TYPES.tracking), {
      language: "fr-CA",
    });
    await client.tracking.getSummary({ pin: "123456789012" });
    expect(first(mock).headers["accept-language"]).toBe("fr-CA");
  });
});

describe("error mapping", () => {
  it("maps a messages body to CanadaPostApiError with every code and description", async () => {
    const { client } = makeClient(xml(ERROR_TWO_MESSAGES, MEDIA_TYPES.rating, 400));
    const err = await client.rating.getRates(RATE_INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostApiError);
    const api = err as CanadaPostApiError;
    expect(api.status).toBe(400);
    expect(api.codes).toEqual(["7007", "1722"]);
    expect(api.code).toBe("7007");
    expect(api.descriptions[0]).toContain("weight value is invalid");
    expect(api.hasCode("1722")).toBe(true);
    expect(api.isRetryable).toBe(false);
    expect(api.request.operation).toBe("rating.getRates");
  });

  it("normalises a single message object", async () => {
    const { client } = makeClient(xml(ERROR_ONE_MESSAGE, MEDIA_TYPES.rating, 400));
    const api = (await client.rating
      .getRates(RATE_INPUT)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(api.codes).toEqual(["9111"]);
  });

  it("treats a messages body on HTTP 200 as an error", async () => {
    const { client } = makeClient(xml(ERROR_TWO_MESSAGES, MEDIA_TYPES.rating, 200));
    const api = (await client.rating
      .getRates(RATE_INPUT)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(api).toBeInstanceOf(CanadaPostApiError);
    expect(api.status).toBe(200);
    expect(api.codes).toEqual(["7007", "1722"]);
  });

  it("captures a request id header when the gateway sends one", async () => {
    const { client } = makeClient({
      status: 403,
      body: "<messages><message><code>AA002</code><description>wrong key</description></message></messages>",
      headers: { "content-type": MEDIA_TYPES.rating, "x-request-id": "req-42" },
    });
    const api = (await client.rating
      .getRates(RATE_INPUT)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(api.requestId).toBe("req-42");
    expect(api.code).toBe("AA002");
  });

  it("copes with a non-XML error body", async () => {
    const { client } = makeClient({ status: 404, body: "<html>nope</html>" }, { retries: 0 });
    const api = (await client.rating
      .getService("DOM.EP")
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(api).toBeInstanceOf(CanadaPostApiError);
    expect(api.messages).toEqual([]);
    expect(api.bodyExcerpt).toContain("nope");
    expect(api.message).toContain("HTTP 404");
  });

  it("all SDK errors share one base class", async () => {
    const { client } = makeClient({ status: 400, body: ERROR_ONE_MESSAGE });
    await expect(client.rating.getRates(RATE_INPUT)).rejects.toBeInstanceOf(CanadaPostError);
  });
});

describe("retry policy", () => {
  it("retries an idempotent GET on 5xx and 429, then succeeds", async () => {
    const { client, mock } = makeClient([
      { status: 503, body: "" },
      { status: 429, body: "", headers: { "retry-after": "0" } },
      xml(TRACKING_SUMMARY_RESPONSE, MEDIA_TYPES.tracking),
    ]);
    const res = await client.tracking.getSummary({ pin: "123456789012" });
    expect(res.pins).toHaveLength(1);
    expect(mock.requests).toHaveLength(3);
  });

  it("gives up after `retries` extra attempts and reports the last error", async () => {
    const { client, mock } = makeClient({ status: 500, body: "" }, { retries: 1 });
    const err = await client.tracking.getSummary({ pin: "123456789012" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostApiError);
    expect((err as CanadaPostApiError).isRetryable).toBe(true);
    expect(mock.requests).toHaveLength(2);
  });

  it("does not retry client errors", async () => {
    const { client, mock } = makeClient({ status: 404, body: ERROR_ONE_MESSAGE });
    await client.tracking.getSummary({ pin: "123456789012" }).catch(() => undefined);
    expect(mock.requests).toHaveLength(1);
  });

  it("never retries a POST, even a read-only quote, on 5xx", async () => {
    const { client, mock } = makeClient({ status: 500, body: "" });
    await client.rating.getRates(RATE_INPUT).catch(() => undefined);
    expect(mock.requests).toHaveLength(1);
  });

  it("reports retries to the debug hook without credentials", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const { client } = makeClient(
      [{ status: 500, body: "" }, xml(TRACKING_SUMMARY_RESPONSE, MEDIA_TYPES.tracking)],
      { onDebug: (e) => events.push(e) },
    );
    await client.tracking.getSummary({ pin: "123456789012" });
    expect(events.map((e) => e.type)).toEqual([
      "request",
      "response",
      "retry",
      "request",
      "response",
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain(expectedBasic().slice(6));
    expect(events[0]?.headers["Authorization"]).toBe("[REDACTED]");
  });
});

describe("timeouts and network errors", () => {
  it("turns a hung GET into CanadaPostTimeoutError", async () => {
    const { client } = makeClient({ hang: true }, { timeoutMs: 20, retries: 0 });
    const err = await client.tracking.getSummary({ pin: "123456789012" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostTimeoutError);
    expect((err as CanadaPostTimeoutError).timeoutMs).toBe(20);
  });

  it("turns a dropped connection into CanadaPostNetworkError with the cause", async () => {
    const cause = new TypeError("fetch failed");
    const { client } = makeClient({ error: cause }, { retries: 0 });
    const err = await client.tracking.getSummary({ pin: "123456789012" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostNetworkError);
    expect((err as CanadaPostNetworkError).cause).toBe(cause);
  });

  it("does not retry timeouts or network errors on GET (only 5xx/429)", async () => {
    const { client, mock } = makeClient({ error: new TypeError("boom") });
    await client.tracking.getSummary({ pin: "123456789012" }).catch(() => undefined);
    expect(mock.requests).toHaveLength(1);
  });
});

describe("credential hygiene", () => {
  it("redacts Authorization and the Zonos key in header copies", () => {
    expect(
      redactHeaders({ Authorization: "Basic abc", "x-cpc-zonos-key": "k", Accept: "a" }),
    ).toEqual({ Authorization: "[REDACTED]", "x-cpc-zonos-key": "[REDACTED]", Accept: "a" });
  });

  it("never puts credentials in error messages or serialisations", async () => {
    const { client } = makeClient({ status: 401, body: "" });
    const err = (await client.rating
      .getRates(RATE_INPUT)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    const dump = `${err.message} ${JSON.stringify(err)} ${String(err.stack)}`;
    expect(dump).not.toContain(TEST_PASSWORD);
    expect(dump).not.toContain(expectedBasic().slice(6));
  });
});
