import { describe, expect, it } from "vitest";
import {
  CanadaPostAccessDeniedError,
  CanadaPostApiError,
  CanadaPostAuthError,
  CanadaPostIndeterminateError,
  CanadaPostNetworkError,
  CanadaPostParseError,
  CanadaPostTimeoutError,
  CanadaPostValidationError,
  type CanadaPostDebugEvent,
} from "../src/index.js";
import {
  FAKE_CREATE_RESPONSE,
  FAKE_QUOTES,
  FAKE_SERVICES,
  SHIPPING,
  fakeCreateRequest,
  fakePriceRequest,
  fakeToken,
  firstApi,
  json,
  makeRestClient,
  FAKE_LINKS,
} from "./support/rest.js";

const ok = json(FAKE_SERVICES);

describe("request headers", () => {
  it("sends bearer auth, JSON accept, language and user agent", async () => {
    const h = makeRestClient(ok);
    await h.client.rating.listServices();
    const r = firstApi(h);
    expect(r.method).toBe("GET");
    expect(r.headers["authorization"]).toBe(`Bearer ${fakeToken(1)}`);
    expect(r.headers["accept"]).toBe("application/json");
    expect(r.headers["accept-language"]).toBe("en-CA");
    expect(r.headers["user-agent"]).toMatch(/^marka-shipping-node\//);
    expect(r.headers["content-type"]).toBeUndefined();
    expect(r.headers["platform-id"]).toBeUndefined();
    expect(r.headers["x-cpc-zonos-key"]).toBeUndefined();
  });

  it("sends JSON bodies with a JSON content type, plus platform-id and language", async () => {
    const h = makeRestClient(json(FAKE_QUOTES), {
      overrides: { platformId: "7654321", language: "fr-CA" },
    });
    await h.client.rating.getPrices(fakePriceRequest());
    const r = firstApi(h);
    expect(r.method).toBe("POST");
    expect(r.headers["content-type"]).toBe("application/json");
    expect(r.headers["platform-id"]).toBe("7654321");
    expect(r.headers["accept-language"]).toBe("fr-CA");
  });
});

describe("reads: retry and 401 replay", () => {
  it("retries a GET on 5xx and 429, then succeeds", async () => {
    const h = makeRestClient([json({}, 503), json({}, 429), ok]);
    await expect(h.client.rating.listServices()).resolves.toHaveLength(1);
    expect(h.apiRequests()).toHaveLength(3);
    expect(h.tokenRequests()).toHaveLength(1);
  });

  it("gives up after the configured retries and throws a retryable API error", async () => {
    const h = makeRestClient(json({ title: "x", detail: "y", errors: [] }, 503));
    const error = (await h.client.rating
      .listServices()
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(error.status).toBe(503);
    expect(error.isRetryable).toBe(true);
    expect(h.apiRequests()).toHaveLength(3);
  });

  it("does not retry a 4xx", async () => {
    const h = makeRestClient(json({ title: "Bad", detail: "d", errors: [] }, 404));
    await expect(h.client.rating.listServices()).rejects.toMatchObject({ status: 404 });
    expect(h.apiRequests()).toHaveLength(1);
  });

  it("honours Retry-After (capped) between retries", async () => {
    const h = makeRestClient([{ status: 429, body: "", headers: { "retry-after": "0" } }, ok], {
      overrides: { retryDelayMs: 0 },
    });
    await h.client.rating.listServices();
    expect(h.apiRequests()).toHaveLength(2);
  });

  it("on 401 refreshes the token ONCE and replays the GET", async () => {
    const h = makeRestClient((request) =>
      request.headers["authorization"] === `Bearer ${fakeToken(2)}`
        ? ok
        : json({ httpCode: "401", httpMessage: "Unauthorized" }, 401),
    );
    await expect(h.client.rating.listServices()).resolves.toHaveLength(1);
    expect(h.tokenRequests()).toHaveLength(2);
    expect(h.apiRequests().map((r) => r.headers["authorization"])).toEqual([
      `Bearer ${fakeToken(1)}`,
      `Bearer ${fakeToken(2)}`,
    ]);
  });

  it("does not loop: a second 401 after the replay is an API error", async () => {
    const h = makeRestClient(json([{ httpCode: 401, httpMessage: "Unauthorized" }], 401));
    const error = (await h.client.rating
      .listServices()
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(error.status).toBe(401);
    expect(h.apiRequests()).toHaveLength(2);
    expect(h.tokenRequests()).toHaveLength(2);
  });

  it("the replay does not use up the 5xx retry budget", async () => {
    const h = makeRestClient([json({}, 401), json({}, 503), json({}, 503), ok]);
    await expect(h.client.rating.listServices()).resolves.toHaveLength(1);
    expect(h.apiRequests()).toHaveLength(4);
  });

  it("keeps a token that another caller already refreshed", async () => {
    // Two overlapping GETs both get 401 for token 1; only one new token must be requested.
    let n = 0;
    const h = makeRestClient((request) => {
      n += 1;
      return request.headers["authorization"] === `Bearer ${fakeToken(1)}` ? json({}, 401) : ok;
    });
    await Promise.all([h.client.rating.listServices(), h.client.rating.listServices()]);
    expect(n).toBe(4);
    expect(h.tokenRequests()).toHaveLength(2);
  });

  it("replays a 401 from a quote POST? no: POSTs are never replayed", async () => {
    const h = makeRestClient(json({}, 401));
    await expect(h.client.rating.getPrices(fakePriceRequest())).rejects.toMatchObject({
      status: 401,
    });
    expect(h.apiRequests()).toHaveLength(1);
  });

  it("a network failure on a read is a typed network error (not indeterminate)", async () => {
    const h = makeRestClient({ error: new TypeError("fetch failed") });
    const error = await h.client.rating.listServices().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostNetworkError);
    expect(error).not.toBeInstanceOf(CanadaPostIndeterminateError);
  });

  it("a hung read times out with a typed timeout error", async () => {
    const h = makeRestClient({ hang: true }, { overrides: { timeoutMs: 15 } });
    const error = await h.client.rating.listServices().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostTimeoutError);
  });

  it("retries a quote POST? never: a 503 on getPrices is final", async () => {
    const h = makeRestClient(json({}, 503));
    await expect(h.client.rating.getPrices(fakePriceRequest())).rejects.toMatchObject({
      status: 503,
    });
    expect(h.apiRequests()).toHaveLength(1);
  });
});

describe("writes are sent exactly once (ADR 0001)", () => {
  const create = (h: ReturnType<typeof makeRestClient>) =>
    h.client.shipments.create(fakeCreateRequest());

  it.each([502, 503, 504])("HTTP %i on create is indeterminate, not retried", async (status) => {
    const h = makeRestClient(json({}, status));
    const error = (await create(h).catch((e: unknown) => e)) as CanadaPostIndeterminateError;
    expect(error).toBeInstanceOf(CanadaPostIndeterminateError);
    expect(error.reason).toBe("gateway");
    expect(error.status).toBe(status);
    expect(error.recovery).toContain("shipments.list");
    expect(h.apiRequests()).toHaveLength(1);
  });

  it("a timeout on create is indeterminate", async () => {
    const h = makeRestClient({ hang: true }, { overrides: { timeoutMs: 15 } });
    const error = (await create(h).catch((e: unknown) => e)) as CanadaPostIndeterminateError;
    expect(error).toBeInstanceOf(CanadaPostIndeterminateError);
    expect(error.reason).toBe("timeout");
    expect(h.apiRequests()).toHaveLength(1);
  });

  it("a dropped connection on create is indeterminate", async () => {
    const h = makeRestClient({ error: new TypeError("fetch failed") });
    const error = (await create(h).catch((e: unknown) => e)) as CanadaPostIndeterminateError;
    expect(error).toBeInstanceOf(CanadaPostIndeterminateError);
    expect(error.reason).toBe("network");
    expect(h.apiRequests()).toHaveLength(1);
  });

  it.each([502, 503, 504])("HTTP %i on void is indeterminate, not retried", async (status) => {
    const h = makeRestClient(json({}, status));
    const error = await h.client.shipments.void("100000000000000001").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostIndeterminateError);
    expect((error as CanadaPostIndeterminateError).recovery).toContain("shipmentStatus");
    expect(h.apiRequests()).toHaveLength(1);
  });

  it.each([400, 404, 412, 429, 500])(
    "HTTP %i on create is a definitive API error",
    async (status) => {
      const h = makeRestClient(json({ title: "No", detail: "Nope", errors: [] }, status));
      const error = await create(h).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CanadaPostApiError);
      expect(error).not.toBeInstanceOf(CanadaPostIndeterminateError);
      expect(h.apiRequests()).toHaveLength(1);
    },
  );

  it("a 401 on create is NOT replayed, but the rejected token is dropped for next time", async () => {
    const h = makeRestClient((request) =>
      request.headers["authorization"] === `Bearer ${fakeToken(1)}`
        ? json({ httpCode: "401" }, 401)
        : json(FAKE_CREATE_RESPONSE),
    );
    await expect(create(h)).rejects.toMatchObject({ status: 401 });
    expect(h.apiRequests()).toHaveLength(1);
    await expect(create(h)).resolves.toMatchObject({ shipmentId: FAKE_CREATE_RESPONSE.shipmentId });
    expect(h.tokenRequests()).toHaveLength(2);
    expect(h.apiRequests()).toHaveLength(2);
  });

  it("a 401 on void is not replayed", async () => {
    const h = makeRestClient(json({}, 401));
    await expect(h.client.shipments.void("100000000000000001")).rejects.toMatchObject({
      status: 401,
    });
    expect(h.apiRequests()).toHaveLength(1);
  });

  it("a token failure before a write sends nothing and is a definitive auth error", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE), { token: () => json({}, 401) });
    await expect(create(h)).rejects.toBeInstanceOf(CanadaPostAuthError);
    expect(h.apiRequests()).toHaveLength(0);
  });

  it("an unparseable 200 on create says the shipment WAS created", async () => {
    const h = makeRestClient({ status: 200, body: "<html>oops</html>" });
    const error = (await create(h).catch((e: unknown) => e)) as CanadaPostParseError;
    expect(error).toBeInstanceOf(CanadaPostParseError);
    expect(error.message).toMatch(/WAS accepted/);
    expect(error.message).not.toContain("oops");
  });

  it("a 200 without shipmentId/links on create says the shipment WAS created", async () => {
    const h = makeRestClient(json({ shipmentStatus: "created" }));
    const error = (await create(h).catch((e: unknown) => e)) as CanadaPostParseError;
    expect(error).toBeInstanceOf(CanadaPostParseError);
    expect(error.message).toMatch(/WAS accepted/);
  });

  it("validates before sending: transmitShipment xor groupId, request id length", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE));
    const neither = { ...fakeCreateRequest(), transmitShipment: undefined } as never;
    const both = { ...fakeCreateRequest(), groupId: "G1" } as never;
    const longId = fakeCreateRequest({ customerRequestId: "x".repeat(36) });
    const emptyId = fakeCreateRequest({ customerRequestId: "" });
    for (const bad of [neither, both, longId, emptyId]) {
      await expect(h.client.shipments.create(bad)).rejects.toBeInstanceOf(
        CanadaPostValidationError,
      );
    }
    expect(h.mock.requests).toHaveLength(0);
  });
});

describe("error mapping", () => {
  const get = (reply: Parameters<typeof makeRestClient>[0]) =>
    makeRestClient(reply)
      .client.rating.listServices()
      .catch((e: unknown) => e) as Promise<CanadaPostApiError>;

  it("maps the documented { title, detail, errors } body", async () => {
    const e = await get(
      json(
        {
          title: "Bad Request",
          detail: "Validation failed",
          errors: [
            { errorCode: "E100", message: "weight is required" },
            { errorCode: "E101", message: "postal code is invalid" },
          ],
        },
        400,
      ),
    );
    expect(e).toBeInstanceOf(CanadaPostApiError);
    expect(e.status).toBe(400);
    expect(e.title).toBe("Bad Request");
    expect(e.detail).toBe("Validation failed");
    expect(e.codes).toEqual(["E100", "E101"]);
    expect(e.descriptions).toEqual(["weight is required", "postal code is invalid"]);
    expect(e.message).toContain("E100: weight is required; E101: postal code is invalid");
    expect(e.hasCode("E101")).toBe(true);
    expect(e.request).toMatchObject({ method: "GET", operation: "rating.listServices" });
  });

  it("falls back to title/detail when there are no entries", async () => {
    const e = await get(json({ title: "Not Found", detail: "No such thing", errors: [] }, 404));
    expect(e.message).toContain("Not Found: No such thing");
  });

  it("maps the gateway 401 object and the array form", async () => {
    const object = await get(
      json({ httpCode: "401", httpMessage: "Unauthorized", moreInformation: "Cannot pass" }, 401),
    );
    expect(object.code).toBe("401");
    expect(object.description).toBe("Unauthorized: Cannot pass");
    const array = await get(
      json([{ httpCode: 401, httpMessage: "Unauthorized", moreInformation: "Cannot pass" }], 401),
    );
    expect(array.code).toBe("401");
  });

  it("maps the Test app schema failure shape", async () => {
    const e = await get(
      json(
        { errorCode: "400", errorMessage: "Schema validation Error", errorDescription: "failed" },
        400,
      ),
    );
    expect(e.code).toBe("400");
    expect(e.description).toBe("Schema validation Error: failed");
    expect(e.title).toBe("Schema validation Error");
  });

  it("maps XML <messages> and keeps plain text as an excerpt", async () => {
    const xml = await get({
      status: 400,
      headers: { "content-type": "application/xml" },
      body: "<messages><message><code>7007</code><description>Bad</description></message></messages>",
    });
    expect(xml.codes).toEqual(["7007"]);
    const text = await get({ status: 500, body: "upstream exploded" });
    expect(text.messages).toEqual([]);
    expect(text.bodyExcerpt).toBe("upstream exploded");
    expect(text.message).toContain("HTTP 500");
  });

  it("copes with an empty or malformed JSON error body", async () => {
    expect((await get({ status: 404, body: "" })).messages).toEqual([]);
    expect((await get({ status: 400, body: "{ not json" })).messages).toEqual([]);
    expect((await get({ status: 400, body: "[1, 2]" })).messages).toEqual([]);
  });

  it("maps a 403 with an EMPTY body to a clear access-denied error", async () => {
    const e = (await get({ status: 403, body: "" })) as unknown as CanadaPostAccessDeniedError;
    expect(e).toBeInstanceOf(CanadaPostAccessDeniedError);
    expect(e).toBeInstanceOf(CanadaPostApiError);
    expect(e.status).toBe(403);
    expect(e.emptyBody).toBe(true);
    expect(e.message).toMatch(/empty body/);
    expect(e.message).toMatch(/linked|authorized/);
  });

  it("maps a 403 with a body to access-denied carrying Canada Post's own message", async () => {
    const e = (await get(
      json(
        {
          title: "Forbidden",
          detail: "Not yours",
          errors: [{ errorCode: "AA002", message: "denied" }],
        },
        403,
      ),
    )) as unknown as CanadaPostAccessDeniedError;
    expect(e).toBeInstanceOf(CanadaPostAccessDeniedError);
    expect(e.emptyBody).toBe(false);
    expect(e.codes).toEqual(["AA002"]);
  });

  it("exposes the gateway transaction id as requestId", async () => {
    const h = makeRestClient({
      status: 400,
      body: "{}",
      headers: { "x-global-transaction-id": "abc123" },
    });
    const e = (await h.client.rating.listServices().catch((x: unknown) => x)) as CanadaPostApiError;
    expect(e.requestId).toBe("abc123");
  });

  it("redacts credential-like query values from the URL in errors and debug events", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const h = makeRestClient(json({}, 404), {
      overrides: {
        onDebug: (e) => {
          events.push(e);
        },
      },
    });
    const link = {
      rel: "publicLabel",
      href: `${SHIPPING}?key-cle=EXAMPLEKEYVALUE01&other=1`,
      mediaType: "application/json",
    };
    const e = (await h.client.followLink(link).catch((x: unknown) => x)) as CanadaPostApiError;
    expect(e.request.url).not.toContain("EXAMPLEKEYVALUE01");
    expect(e.request.url).toContain("other=1");
    expect(JSON.stringify(events)).not.toContain("EXAMPLEKEYVALUE01");
  });
});

describe("links", () => {
  it("follows only links on the Canada Post REST host", async () => {
    const h = makeRestClient(json({ ok: true }));
    const bad = [
      "https://evil.example/prod/devportal-portaildesdeveloppeurs/shipping/v1/x",
      "http://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/shipping/v1/x",
      "https://api.canadapost-postescanada.ca.evil.example/prod/devportal-portaildesdeveloppeurs/x",
      "https://user:pw@api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/x",
      "https://api.canadapost-postescanada.ca/other/path",
      "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs-evil/x",
      "https://api.canadapost-postescanada.ca:8443/prod/devportal-portaildesdeveloppeurs/x",
      "not a url",
      "//evil.example/x",
    ];
    for (const href of bad) {
      await expect(
        h.client.followLink({ rel: "x", href, mediaType: "application/json" }),
      ).rejects.toMatchObject({ name: "CanadaPostConfigurationError" });
    }
    expect(h.mock.requests).toHaveLength(0);
  });

  it("never echoes a capability URL in the refusal message", async () => {
    const h = makeRestClient(json({}));
    const error = (await h.client
      .followLink({
        rel: "publicLabel",
        href: "https://evil.example/path?key-cle=EXAMPLESECRETKEY",
        mediaType: "application/pdf",
      })
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("EXAMPLESECRETKEY");
  });

  it("follows a JSON link and a PDF link", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const h = makeRestClient((request) =>
      request.headers["accept"] === "application/pdf"
        ? { status: 200, body: pdf, headers: { "content-type": "application/pdf" } }
        : json({ hello: "world" }),
    );
    const [self, , , label] = FAKE_LINKS;
    const asJson = await h.client.followLink(self!);
    expect(asJson).toMatchObject({
      kind: "json",
      rel: "self",
      status: 200,
      body: { hello: "world" },
    });
    const asPdf = await h.client.followLink(label!);
    expect(asPdf).toMatchObject({ kind: "binary", rel: "label", contentType: "application/pdf" });
  });
});
