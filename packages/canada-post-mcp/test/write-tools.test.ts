import { afterEach, describe, expect, it } from "vitest";
import { InMemoryPreviewStore, sealPreview, type PreviewRecord } from "../src/preview-store.js";
import { McpStartupError, createCanadaPostMcpServer } from "../src/server.js";
import { createCanadaPostRestClient } from "@joinmarka/canada-post";
import { createMockFetch } from "@joinmarka/canada-post/testing";
import { loadConfigFromEnv } from "../src/config.js";
import {
  ACCESS_TOKEN,
  BASE_ENV,
  CUSTOMER,
  QUOTES,
  SECRET,
  TOKEN_URL,
  json,
  makeHarness,
  type Harness,
  type Route,
} from "./support/harness.js";
import {
  CREATE_INPUT,
  CREATE_RESPONSE,
  PICKUP_INPUT,
  PICKUP_PRICE,
  PIN,
  RETURN_INPUT,
  SHIPMENT_ID,
  SHIPMENT_INFO,
  TRANSMIT_INPUT,
} from "./support/fixtures.js";

const WRITES = { CANADAPOST_MCP_ALLOW_WRITES: "true" };
const PRODUCTION = {
  CANADAPOST_APP: "production",
  CANADAPOST_MCP_ALLOW_WRITES: "true",
  CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: "true",
};

const WRITE_TOOL_NAMES = [
  "canadapost_apply",
  "canadapost_preview_cancel_pickup",
  "canadapost_preview_create_pickup",
  "canadapost_preview_create_return",
  "canadapost_preview_create_shipment",
  "canadapost_preview_refund_shipment",
  "canadapost_preview_transmit_manifest",
  "canadapost_preview_void_shipment",
];

let harness: Harness | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

const link = (rel: string, path: string) => ({
  rel,
  href: `https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs${path}`,
  mediaType: "application/json",
});

/** Scripted Canada Post answers for every write the tools can apply. */
const WRITE_ROUTES: Route[] = [
  {
    method: "POST",
    path: /\/shipping\/v1\/1234567\/1234567\/shipments$/,
    reply: json(CREATE_RESPONSE),
  },
  { method: "GET", path: new RegExp(`/shipments/${SHIPMENT_ID}$`), reply: json(SHIPMENT_INFO) },
  { method: "DELETE", path: new RegExp(`/shipments/${SHIPMENT_ID}$`), reply: { status: 204 } },
  {
    method: "POST",
    path: new RegExp(`/shipments/${SHIPMENT_ID}/refund$`),
    reply: json({ serviceTicketDate: "2026-11-16", serviceTicketId: "TICKET0001" }),
  },
  {
    method: "GET",
    path: /\/shipping\/v1\/1234567\/1234567\/groups$/,
    reply: json([
      {
        groupId: "GROUP1",
        link: link("group", "/shipping/v1/1234567/1234567/shipments?group-id=GROUP1"),
      },
    ]),
  },
  {
    method: "POST",
    path: /\/shipping\/v1\/1234567\/1234567\/manifests$/,
    reply: json([link("manifest", "/shipping/v1/1234567/1234567/manifests/PO00000001")]),
  },
  {
    method: "GET",
    path: /\/pickup\/v1\/1234567\/pickup-request\/price$/,
    reply: json(PICKUP_PRICE),
  },
  {
    method: "POST",
    path: /\/pickup\/v1\/1234567\/pickup-request$/,
    reply: json({
      pickupRequestHeader: {
        requestId: "11104183",
        requestStatus: "Pending",
        pickupType: "OnDemand",
      },
      pickupRequestPrice: PICKUP_PRICE,
      links: [link("self", "/pickup/v1/1234567/pickup-request/11104183")],
    }),
  },
  {
    method: "GET",
    path: /\/pickup-request\/11104183\/details$/,
    reply: json({ pickupRequestHeader: { requestId: "11104183", requestStatus: "Pending" } }),
  },
  { method: "DELETE", path: /\/pickup-request\/11104183$/, reply: { status: 204 } },
  {
    method: "POST",
    path: /\/returns\/v1\/1234567\/1234567\/authorized-returns$/,
    reply: json({
      trackingPin: "7023210215628999",
      customerBarcode: "RET0000001",
      links: [link("label", "/returns/v1/artifacts/1234567/authorized-returns/ART0001/0")],
    }),
  },
];

async function start(env: Record<string, string> = WRITES, routes: Route[] = WRITE_ROUTES) {
  harness = await makeHarness({ env, routes });
  return harness;
}

/** Requests that could change state at Canada Post (everything but GETs and rating POSTs). */
function mutating(h: Harness) {
  return h.apiRequests().filter((r) => r.method !== "GET" && !r.url.includes("/rating/"));
}

const PREVIEWS: Array<{
  tool: string;
  args: Record<string, unknown>;
  operation: string;
  /** Request line the apply must produce. */
  sent: { method: string; path: RegExp };
}> = [
  {
    tool: "canadapost_preview_create_shipment",
    args: CREATE_INPUT,
    operation: "shipment.create",
    sent: { method: "POST", path: /\/shipments$/ },
  },
  {
    tool: "canadapost_preview_void_shipment",
    args: { shipmentId: SHIPMENT_ID },
    operation: "shipment.void",
    sent: { method: "DELETE", path: new RegExp(`/shipments/${SHIPMENT_ID}$`) },
  },
  {
    tool: "canadapost_preview_refund_shipment",
    args: { shipmentId: SHIPMENT_ID, email: "refunds@example.com" },
    operation: "shipment.refund",
    sent: { method: "POST", path: /\/refund$/ },
  },
  {
    tool: "canadapost_preview_transmit_manifest",
    args: TRANSMIT_INPUT,
    operation: "manifest.transmit",
    sent: { method: "POST", path: /\/manifests$/ },
  },
  {
    tool: "canadapost_preview_create_pickup",
    args: PICKUP_INPUT,
    operation: "pickup.create",
    sent: { method: "POST", path: /\/pickup-request$/ },
  },
  {
    tool: "canadapost_preview_cancel_pickup",
    args: { requestId: "11104183" },
    operation: "pickup.cancel",
    sent: { method: "DELETE", path: /\/pickup-request\/11104183$/ },
  },
  {
    tool: "canadapost_preview_create_return",
    args: RETURN_INPUT,
    operation: "return.create",
    sent: { method: "POST", path: /\/authorized-returns$/ },
  },
];

describe("which tools exist", () => {
  it.each([
    ["test app, no flags", {}, 20, false],
    ["test app, writes on", WRITES, 28, true],
    [
      "test app, only the production flag",
      { CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: "true" },
      20,
      false,
    ],
    ["production, no flags", { CANADAPOST_APP: "production" }, 20, false],
    [
      "production, writes on without the production flag",
      { CANADAPOST_APP: "production", CANADAPOST_MCP_ALLOW_WRITES: "true" },
      20,
      false,
    ],
    [
      "production, only the production flag",
      { CANADAPOST_APP: "production", CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: "true" },
      20,
      false,
    ],
    ["production, both flags", PRODUCTION, 28, true],
  ])("%s -> %i tools", async (_name, env, count, hasWrites) => {
    harness = await makeHarness({ env, routes: WRITE_ROUTES });
    const names = await harness.toolNames();
    expect(names).toHaveLength(count);
    for (const name of WRITE_TOOL_NAMES) expect(names.includes(name)).toBe(hasWrites);
  });

  it("warns on stderr when production writes are half enabled", async () => {
    harness = await makeHarness({
      env: { CANADAPOST_APP: "production", CANADAPOST_MCP_ALLOW_WRITES: "true" },
    });
    expect(harness.logs.some((l) => l.event === "writes_disabled")).toBe(true);
  });

  it("logs a production-writes warning when they are on", async () => {
    harness = await makeHarness({ env: PRODUCTION });
    expect(harness.logs.some((l) => l.event === "production_writes_enabled")).toBe(true);
  });

  it("a write tool is marked non-read-only, and apply is the destructive one", async () => {
    const h = await start();
    const { tools } = await h.mcp.listTools();
    for (const tool of tools.filter((t) => WRITE_TOOL_NAMES.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(tool.name === "canadapost_apply");
    }
  });
});

describe("Test-app proof at startup", () => {
  it("runs assertTestApp once (two quotes) before enabling writes", async () => {
    const h = await start();
    const rating = h.apiRequests().filter((r) => r.url.includes("/rating/v1/prices"));
    expect(rating).toHaveLength(2);
    expect(h.logs.some((l) => l.event === "test_app_verified")).toBe(true);
  });

  it("does not probe anything when writes are off", async () => {
    harness = await makeHarness({ env: {}, routes: [] });
    expect(harness.mock.requests).toHaveLength(0);
  });

  it("does not probe a declared production app", async () => {
    harness = await makeHarness({ env: PRODUCTION });
    expect(harness.apiRequests()).toHaveLength(0);
  });

  it("fails closed when the credentials do not behave like a Test app", async () => {
    let n = 0;
    const mock = createMockFetch((request) => {
      if (request.url === TOKEN_URL) {
        return json({ token_type: "Bearer", access_token: ACCESS_TOKEN, expires_in: 3600 });
      }
      n += 1;
      // Real quotes differ with the parcel, so two different requests give different bodies.
      return json([{ ...QUOTES[0], priceDetails: { base: n, due: n } }]);
    });
    const config = loadConfigFromEnv({ ...BASE_ENV, ...WRITES });
    const client = createCanadaPostRestClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      customerNumber: config.customerNumber,
      app: "test",
      fetch: mock.fetch,
      retryDelayMs: 0,
    });
    const error = await createCanadaPostMcpServer({
      config,
      client,
      logger: () => undefined,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpStartupError);
    expect((error as Error).message).toContain("Refusing to enable write tools");
    expect((error as Error).message).not.toContain(SECRET);
  });

  it("still serves read tools when writes are off, whatever the credentials", async () => {
    const config = loadConfigFromEnv(BASE_ENV);
    const mock = createMockFetch(() => json([], 500));
    const client = createCanadaPostRestClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      customerNumber: config.customerNumber,
      fetch: mock.fetch,
    });
    const handle = await createCanadaPostMcpServer({ config, client, logger: () => undefined });
    expect(handle.toolNames).toHaveLength(20);
    expect(mock.requests).toHaveLength(0);
  });
});

describe("preview then apply", () => {
  it.each(PREVIEWS)("$tool previews without changing anything", async (p) => {
    const h = await start();
    const r = await h.call(p.tool, p.args);
    expect(r.isError, JSON.stringify(r.data)).toBe(false);
    expect(r.data.operation).toBe(p.operation);
    expect(r.data.app).toBe("test");
    expect(r.data.mayCharge).toBe(false);
    expect(String(r.data.mode)).toContain("TEST APP");
    expect(typeof r.data.confirmToken).toBe("string");
    expect(String(r.data.confirmToken)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.data.expiresInSeconds).toBe(300);
    expect(Date.parse(String(r.data.expiresAt))).toBe(h.clock.now + 300_000);
    expect(r.data.request).toBeDefined();
    expect(String(r.data.next)).toContain("canadapost_apply");
    expect(mutating(h)).toHaveLength(0);
    expect(h.store.size()).toBe(1);
  });

  it.each(PREVIEWS)("$tool applies exactly once and sends the previewed request", async (p) => {
    const h = await start();
    const preview = await h.call(p.tool, p.args);
    const token = String(preview.data.confirmToken);
    const applied = await h.call("canadapost_apply", { confirmToken: token });
    expect(applied.isError, JSON.stringify(applied.data)).toBe(false);
    expect(applied.data.applied).toBe(true);
    expect(applied.data.operation).toBe(p.operation);
    expect(applied.data.charged).toBe(false);
    expect(String(applied.data.notice)).toContain("Test app");
    const sent = mutating(h);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe(p.sent.method);
    expect(sent[0]?.url.split("?")[0]).toMatch(p.sent.path);
    const again = await h.call("canadapost_apply", { confirmToken: token });
    expect(again.isError).toBe(true);
    expect(again.data.errorCode).toBe("preview_already_used");
    expect(mutating(h)).toHaveLength(1);
  });

  it("the shipment preview shows the quote and the apply sends the same body", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_create_shipment", CREATE_INPUT);
    expect(preview.data.quote).toEqual(QUOTES);
    const request = preview.data.request as Record<string, unknown>;
    expect(request.transmitShipment).toBe(true);
    expect(request.providePricingInfo).toBe(true);
    expect(request.customerRequestId).toBe("REQ-0001");
    const applied = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(applied.data.shipmentId).toBe(SHIPMENT_ID);
    expect(applied.data.trackingPin).toBe(PIN);
    expect(JSON.stringify(applied.data)).toContain("canadapost_shipment_label");
    const body = JSON.parse(mutating(h)[0]?.body ?? "{}") as Record<string, unknown>;
    expect(body).toEqual(JSON.parse(JSON.stringify(request)));
  });

  it("generates a customerRequestId that fits Canada Post when none is given", async () => {
    const h = await start();
    const { customerRequestId: _omit, ...rest } = CREATE_INPUT;
    const preview = await h.call("canadapost_preview_create_shipment", rest);
    const id = (preview.data.request as { customerRequestId: string }).customerRequestId;
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(35);
  });

  it("a grouped shipment is not transmitted and carries a warning", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_create_shipment", {
      ...CREATE_INPUT,
      groupId: "GROUP1",
    });
    const request = preview.data.request as Record<string, unknown>;
    expect(request.groupId).toBe("GROUP1");
    expect(request.transmitShipment).toBeUndefined();
    expect((preview.data.warnings as string[])[0]).toContain("manifest");
  });

  it("the manifest preview checks the group ids", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_transmit_manifest", {
      ...TRANSMIT_INPUT,
      groupIds: ["GROUP1", "NOPE"],
    });
    expect(preview.data.groupCheck).toEqual({ knownGroups: 1, unknownGroupIds: ["NOPE"] });
    expect((preview.data.warnings as string[])[0]).toContain("NOPE");
  });

  it("previews report an unreadable lookup instead of failing", async () => {
    const h = await start(WRITES, [
      {
        method: "GET",
        path: new RegExp(`/shipments/${SHIPMENT_ID}$`),
        reply: json({ messages: [{ code: "E1", description: "not found" }] }, 404),
      },
      ...WRITE_ROUTES,
    ]);
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    expect(preview.isError).toBe(false);
    expect(preview.data.current).toMatchObject({ error: { errorCode: "api_error" } });
  });

  it("validates input before storing anything", async () => {
    const h = await start();
    const bad = await h.call("canadapost_preview_create_shipment", {
      ...CREATE_INPUT,
      deliverySpec: { ...CREATE_INPUT.deliverySpec, serviceCode: "" },
    });
    expect(bad.isError).toBe(true);
    const extra = await h.call("canadapost_preview_void_shipment", {
      shipmentId: SHIPMENT_ID,
      force: true,
    });
    expect(extra.isError).toBe(true);
    expect((await h.call("canadapost_preview_void_shipment", { shipmentId: "../x" })).isError).toBe(
      true,
    );
    expect(h.store.size()).toBe(0);
  });

  it("apply takes nothing but the token", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    const token = String(preview.data.confirmToken);
    const smuggled = await h.call("canadapost_apply", {
      confirmToken: token,
      request: { shipmentId: "999" },
    });
    expect(smuggled.isError).toBe(true);
    expect(mutating(h)).toHaveLength(0);
    // The rejected call did not consume the token.
    const ok = await h.call("canadapost_apply", { confirmToken: token });
    expect(ok.isError).toBe(false);
  });
});

describe("token lifecycle", () => {
  it("expires after the lifetime", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    h.clock.now += 300_000;
    const r = await h.call("canadapost_apply", { confirmToken: String(preview.data.confirmToken) });
    expect(r.isError).toBe(true);
    expect(r.data.errorCode).toBe("preview_expired");
    expect(mutating(h)).toHaveLength(0);
  });

  it("is still valid one second before expiry", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    h.clock.now += 299_000;
    const r = await h.call("canadapost_apply", { confirmToken: String(preview.data.confirmToken) });
    expect(r.isError).toBe(false);
  });

  it("honours a configured lifetime", async () => {
    const h = await start({ ...WRITES, CANADAPOST_MCP_PREVIEW_TTL_SECONDS: "60" });
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    expect(preview.data.expiresInSeconds).toBe(60);
    h.clock.now += 61_000;
    const r = await h.call("canadapost_apply", { confirmToken: String(preview.data.confirmToken) });
    expect(r.data.errorCode).toBe("preview_expired");
  });

  it("refuses an unknown token", async () => {
    const h = await start();
    const r = await h.call("canadapost_apply", { confirmToken: "x".repeat(43) });
    expect(r.data.errorCode).toBe("preview_not_found");
    expect((await h.call("canadapost_apply", { confirmToken: "short" })).isError).toBe(true);
    expect(mutating(h)).toHaveLength(0);
  });

  it("refuses a record sealed with another key and sends nothing", async () => {
    const h = await start();
    const foreign: PreviewRecord = sealPreview(
      { key: "z".repeat(32), app: "test", customerNumber: CUSTOMER },
      {
        kind: "shipment.void",
        request: { shipmentId: SHIPMENT_ID },
        now: h.clock.now,
        ttlSeconds: 300,
      },
    );
    h.store.put(foreign);
    const r = await h.call("canadapost_apply", { confirmToken: foreign.id });
    expect(r.data.errorCode).toBe("preview_tampered");
    expect(mutating(h)).toHaveLength(0);
  });

  it("refuses a stored request that was altered after the preview", async () => {
    class TamperingStore extends InMemoryPreviewStore {
      override consume(id: string, now: number) {
        const result = super.consume(id, now);
        if (result.status === "ok") {
          return {
            status: "ok" as const,
            record: { ...result.record, request: { shipmentId: "999" } },
          };
        }
        return result;
      }
    }
    harness = await makeHarness({
      env: WRITES,
      routes: WRITE_ROUTES,
      previewStore: new TamperingStore(),
    });
    const preview = await harness.call("canadapost_preview_void_shipment", {
      shipmentId: SHIPMENT_ID,
    });
    const r = await harness.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(r.data.errorCode).toBe("preview_tampered");
    expect(mutating(harness)).toHaveLength(0);
  });

  it("limits the number of pending previews", async () => {
    const h = await start();
    for (let i = 0; i < 100; i += 1) {
      const r = await h.call("canadapost_preview_cancel_pickup", { requestId: "11104183" });
      expect(r.isError).toBe(false);
    }
    const over = await h.call("canadapost_preview_cancel_pickup", { requestId: "11104183" });
    expect(over.isError).toBe(true);
    expect(over.data.errorCode).toBe("too_many_previews");
  });

  it("a token from a Test-app server is useless to a production one", async () => {
    const h = await start();
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    const second = await makeHarness({ env: PRODUCTION, routes: WRITE_ROUTES });
    try {
      const r = await second.call("canadapost_apply", {
        confirmToken: String(preview.data.confirmToken),
      });
      expect(r.data.errorCode).toBe("preview_not_found");
      expect(mutating(second)).toHaveLength(0);
    } finally {
      await second.close();
    }
  });
});

describe("production", () => {
  it("states that real postage is charged, on the preview and on the apply", async () => {
    const h = await start(PRODUCTION);
    expect(h.apiRequests()).toHaveLength(0);
    const preview = await h.call("canadapost_preview_create_shipment", CREATE_INPUT);
    expect(preview.isError, JSON.stringify(preview.data)).toBe(false);
    expect(preview.data.app).toBe("production");
    expect(preview.data.mayCharge).toBe(true);
    expect(String(preview.data.mode)).toContain("CHARGES REAL POSTAGE");
    const applied = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(applied.data.app).toBe("production");
    expect(applied.data.charged).toBe(true);
    expect(String(applied.data.notice)).toContain("REAL POSTAGE");
  });

  it("does not claim a charge for operations that cost nothing", async () => {
    const h = await start(PRODUCTION);
    const preview = await h.call("canadapost_preview_void_shipment", { shipmentId: SHIPMENT_ID });
    expect(preview.data.mayCharge).toBe(false);
    expect(String(preview.data.mode)).toContain("changes the real Canada Post account");
    const applied = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(applied.data.charged).toBe(false);
    expect(String(applied.data.notice)).toContain("no postage was charged");
  });

  it.each(
    PREVIEWS.filter((p) =>
      ["shipment.create", "manifest.transmit", "pickup.create", "return.create"].includes(
        p.operation,
      ),
    ),
  )("$operation is reported as charging", async (p) => {
    const h = await start(PRODUCTION);
    const preview = await h.call(p.tool, p.args);
    expect(preview.data.mayCharge).toBe(true);
    const applied = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(applied.data.charged).toBe(true);
  });
});

describe("failures at apply", () => {
  it("never retries an ambiguous create and reports it as indeterminate", async () => {
    const h = await start(WRITES, [
      {
        method: "POST",
        path: /\/shipping\/v1\/1234567\/1234567\/shipments$/,
        reply: { error: new Error("socket hang up") },
      },
      ...WRITE_ROUTES,
    ]);
    const preview = await h.call("canadapost_preview_create_shipment", CREATE_INPUT);
    const applied = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(applied.isError).toBe(true);
    expect(applied.data.errorCode).toBe("indeterminate");
    expect(String(applied.data.recovery).length).toBeGreaterThan(0);
    expect(applied.data.customerRequestId).toBe("REQ-0001");
    expect(String(applied.data.message)).toContain("consumed");
    expect(mutating(h)).toHaveLength(1);
    // The consumed token cannot be replayed to create a second shipment.
    const replay = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(replay.data.errorCode).toBe("preview_already_used");
    expect(mutating(h)).toHaveLength(1);
  });

  it("maps a Canada Post rejection and consumes the token", async () => {
    const h = await start(WRITES, [
      {
        method: "POST",
        path: /\/shipping\/v1\/1234567\/1234567\/shipments$/,
        reply: json({ messages: [{ code: "E9", description: "Invalid postal code" }] }, 400),
      },
      ...WRITE_ROUTES,
    ]);
    const preview = await h.call("canadapost_preview_create_shipment", CREATE_INPUT);
    const applied = await h.call("canadapost_apply", {
      confirmToken: String(preview.data.confirmToken),
    });
    expect(applied.isError).toBe(true);
    expect(applied.data.errorCode).toBe("api_error");
    expect(applied.data.httpStatus).toBe(400);
    expect(applied.data.customerRequestId).toBe("REQ-0001");
    expect(String(applied.data.message)).toContain("create a new preview");
    expect(mutating(h)).toHaveLength(1);
  });
});

describe("secrets", () => {
  it("no tool answer, log line or error contains a credential or the token", async () => {
    const h = await start(WRITES, [
      {
        method: "POST",
        path: /\/pickup-request$/,
        reply: { status: 500, body: `server said ${SECRET} Bearer ${ACCESS_TOKEN}-zzzzzz` },
      },
      ...WRITE_ROUTES,
    ]);
    const outputs: unknown[] = [];
    for (const p of PREVIEWS) {
      const preview = await h.call(p.tool, p.args);
      outputs.push(preview);
      outputs.push(
        await h.call("canadapost_apply", { confirmToken: String(preview.data.confirmToken) }),
      );
    }
    const everything = JSON.stringify([outputs, h.logs]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(ACCESS_TOKEN);
    expect(everything).not.toContain(h.config.previewHmacKey);
  });
});
