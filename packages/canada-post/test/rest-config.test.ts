import { describe, expect, it, vi } from "vitest";
import {
  CanadaPostConfigurationError,
  REST_BASE_URL,
  createCanadaPostRestClient,
  type CanadaPostRestClientOptions,
} from "../src/index.js";
import { resolveRestConfig } from "../src/rest/config.js";
import { parseErrorBody } from "../src/rest/error-body.js";
import { SecretRedactor, retryAfterMs, safeUrl } from "../src/rest/redact.js";
import { TEST_CLIENT_ID, TEST_CLIENT_SECRET, TEST_CUSTOMER } from "./support/rest.js";

const base: CanadaPostRestClientOptions = {
  clientId: TEST_CLIENT_ID,
  clientSecret: TEST_CLIENT_SECRET,
  customerNumber: TEST_CUSTOMER,
  fetch: (() => Promise.reject(new Error("no network in config tests"))) as typeof fetch,
};

describe("REST client configuration", () => {
  it("applies the documented defaults", () => {
    const config = resolveRestConfig(base);
    expect(config).toMatchObject({
      app: "test",
      scope: "merchant",
      mobo: TEST_CUSTOMER,
      timeoutMs: 30_000,
      retries: 2,
      retryDelayMs: 250,
      tokenRefreshSkewMs: 60_000,
      language: "en-CA",
      platformId: undefined,
      zonosKey: undefined,
    });
  });

  it("trims credentials and exposes the base URL and declared app", () => {
    const client = createCanadaPostRestClient({
      ...base,
      clientId: `  ${TEST_CLIENT_ID} `,
      app: "production",
    });
    expect(client.app).toBe("production");
    expect(client.baseUrl).toBe(REST_BASE_URL);
    expect(REST_BASE_URL).toBe(
      "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs",
    );
  });

  it.each([
    ["clientId", { clientId: "" }],
    ["clientId", { clientId: "   " }],
    ["clientSecret", { clientSecret: "" }],
    ["customerNumber", { customerNumber: "" }],
    ["customerNumber", { customerNumber: "12 34" }],
    ["customerNumber", { customerNumber: "1".repeat(19) }],
    ["customerNumber", { customerNumber: "../1" }],
    ["mobo", { mobo: "abc" }],
    ["scope", { scope: "admin" as never }],
    ["app", { app: "staging" as never }],
    ["timeoutMs", { timeoutMs: 0 }],
    ["timeoutMs", { timeoutMs: Number.NaN }],
    ["retries", { retries: -1 }],
    ["retries", { retries: 11 }],
    ["retries", { retries: 1.5 }],
    ["retryDelayMs", { retryDelayMs: -1 }],
    ["tokenRefreshSkewMs", { tokenRefreshSkewMs: -1 }],
    ["platformId", { platformId: "  " }],
    ["zonosKey", { zonosKey: "  " }],
  ] satisfies Array<[string, Partial<CanadaPostRestClientOptions>]>)(
    "rejects an invalid %s",
    (field, patch) => {
      const make = (): unknown => resolveRestConfig({ ...base, ...patch });
      expect(make).toThrow(CanadaPostConfigurationError);
      expect(make).toThrow(new RegExp(field));
    },
  );

  it("accepts an empty mobo, platformId and zonosKey as 'not set'", () => {
    const config = resolveRestConfig({ ...base, mobo: "", platformId: "", zonosKey: "" });
    expect(config.mobo).toBe(TEST_CUSTOMER);
    expect(config.platformId).toBeUndefined();
    expect(config.zonosKey).toBeUndefined();
  });

  it("needs a fetch implementation", () => {
    vi.stubGlobal("fetch", undefined);
    try {
      const { fetch: _omit, ...withoutFetch } = base;
      expect(() => resolveRestConfig(withoutFetch)).toThrow(/fetch implementation/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("redaction helpers", () => {
  it("scrubs registered secrets and ignores short or missing values", () => {
    const redactor = new SecretRedactor();
    redactor.add("abcdef-secret");
    redactor.add("ab");
    redactor.add(undefined);
    expect(redactor.scrub("x abcdef-secret y abcdef-secret ab")).toBe(
      "x [REDACTED] y [REDACTED] ab",
    );
  });

  it("redacts credential-like query values, userinfo and keeps harmless parameters", () => {
    expect(safeUrl("https://h.test/p?key-cle=abc&country=CA&Token=zz&signature=1")).toBe(
      "https://h.test/p?key-cle=[REDACTED]&country=CA&Token=[REDACTED]&signature=[REDACTED]",
    );
    expect(safeUrl("https://user:pw@h.test/p")).toBe("https://h.test/p");
    expect(safeUrl("not a url?key=1")).toBe("not a url");
    expect(safeUrl("https://h.test/p")).toBe("https://h.test/p");
  });

  it("parses Retry-After and caps it at 30 s", () => {
    expect(retryAfterMs(new Headers())).toBeUndefined();
    expect(retryAfterMs(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(retryAfterMs(new Headers({ "retry-after": "900" }))).toBe(30_000);
    expect(retryAfterMs(new Headers({ "retry-after": "-1" }))).toBeUndefined();
    expect(
      retryAfterMs(new Headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })),
    ).toBeUndefined();
  });
});

describe("error body parsing", () => {
  it("reads every shape Canada Post and its gateway produce", () => {
    expect(
      parseErrorBody(
        JSON.stringify({ title: "T", detail: "D", errors: [{ errorCode: "E1", message: "m" }] }),
      ),
    ).toEqual({ messages: [{ code: "E1", description: "m" }], title: "T", detail: "D" });
    expect(parseErrorBody(JSON.stringify({ title: "T" })).messages).toEqual([
      { code: "", description: "T" },
    ]);
    expect(
      parseErrorBody(JSON.stringify([{ httpCode: 401, httpMessage: "U", moreInformation: "M" }]))
        .messages,
    ).toEqual([{ code: "401", description: "U: M" }]);
    expect(
      parseErrorBody(
        JSON.stringify({ errorCode: "400", errorMessage: "S", errorDescription: "F" }),
      ),
    ).toMatchObject({ title: "S", detail: "F", messages: [{ code: "400", description: "S: F" }] });
    expect(parseErrorBody(JSON.stringify({ error: "x", error_description: "d" })).messages).toEqual(
      [{ code: "x", description: "d" }],
    );
    expect(
      parseErrorBody(
        "<messages><message><code>1</code><description>d</description></message></messages>",
      ).messages,
    ).toEqual([{ code: "1", description: "d" }]);
  });

  it("returns nothing for unreadable bodies", () => {
    for (const body of ["", "   ", "plain text", "{ broken", "[1,2]", "null", "[]", "{}"]) {
      expect(parseErrorBody(body).messages, body).toEqual([]);
    }
  });

  it("ignores malformed entries inside a valid body", () => {
    expect(
      parseErrorBody(JSON.stringify({ errors: [1, null, { errorCode: 5 }, { message: "only" }] }))
        .messages,
    ).toEqual([
      { code: "5", description: "" },
      { code: "", description: "only" },
    ]);
  });
});
