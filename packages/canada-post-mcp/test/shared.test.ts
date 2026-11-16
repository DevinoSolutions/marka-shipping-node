import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanadaPostIndeterminateError,
  CanadaPostTestAppRequiredError,
  CanadaPostValidationError,
  createCanadaPostRestClient,
} from "@joinmarka/canada-post";
import { loadConfigFromEnv } from "../src/config.js";
import { InMemoryPreviewStore } from "../src/preview-store.js";
import { createCanadaPostMcpServer, stderrLogger } from "../src/server.js";
import {
  linkView,
  mapErrorToPayload,
  newRequestId,
  scrubText,
  type ToolContext,
} from "../src/tools/shared.js";
import { BASE_ENV, CLIENT_ID, SECRET } from "./support/harness.js";

const config = loadConfigFromEnv(BASE_ENV);
const logs: Array<{ event: string; fields?: Record<string, unknown> | undefined }> = [];
const ctx: ToolContext = {
  client: createCanadaPostRestClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    customerNumber: config.customerNumber,
  }),
  config,
  previewStore: new InMemoryPreviewStore(),
  logger: (_level, event, fields) => {
    logs.push({ event, fields });
  },
  now: () => 1_800_000_000_000,
};

afterEach(() => {
  logs.length = 0;
  vi.restoreAllMocks();
});

describe("error mapping", () => {
  it("reduces an unexpected error to a generic payload and logs a scrubbed detail", () => {
    const payload = mapErrorToPayload(new TypeError(`broke with ${SECRET}`), ctx);
    expect(payload.errorCode).toBe("internal");
    expect(payload.message).toBe("internal error");
    expect(typeof payload.correlationId).toBe("string");
    const logged = JSON.stringify(logs);
    expect(logged).toContain("unexpected_tool_error");
    expect(logged).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });

  it("keeps the recovery text of an indeterminate write", () => {
    const error = new CanadaPostIndeterminateError({
      request: {
        method: "POST",
        url: "https://api.example/shipments",
        operation: "shipments.create",
      },
      reason: "network",
      recovery: "List shipments by customerRequestId before retrying.",
    });
    const payload = mapErrorToPayload(error, ctx);
    expect(payload.errorCode).toBe("indeterminate");
    expect(payload.recovery).toContain("customerRequestId");
  });

  it("maps validation and test-app errors to their own codes", () => {
    expect(mapErrorToPayload(new CanadaPostValidationError("bad"), ctx).errorCode).toBe(
      "validation",
    );
    expect(
      mapErrorToPayload(new CanadaPostTestAppRequiredError("responses-differ", "nope"), ctx)
        .errorCode,
    ).toBe("test_app_required");
  });
});

describe("scrubbing", () => {
  it("removes bearer tokens, query strings and configured secrets", () => {
    const text = scrubText(
      `GET https://x.example/a?token=abc&k=v failed: Bearer abcdefghijklmnop ${SECRET} ${CLIENT_ID}`,
      config,
    );
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("token=abc");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(CLIENT_ID);
    expect(text).toContain("[query removed]");
  });

  it("redacts credential-like query values of links and keeps the others", () => {
    const view = linkView({
      rel: "label",
      href: "https://api.example/a/b?format=pdf&accessToken=SECRETVALUE&sig=XYZ",
      mediaType: "application/pdf",
    });
    expect(view.href).toContain("format=pdf");
    expect(view.href).not.toContain("SECRETVALUE");
    expect(view.href).not.toContain("XYZ");
    expect(linkView({ rel: "x", href: "not a url?token=abc", mediaType: "" }).href).toBe(
      "not a url",
    );
  });

  it("builds request ids Canada Post accepts", () => {
    const id = newRequestId("MCP", 1_800_000_000_000);
    expect(id.length).toBeLessThanOrEqual(35);
    expect(id).toMatch(/^MCP-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(newRequestId("MCP", 1)).not.toBe(newRequestId("MCP", 1));
  });
});

describe("logging", () => {
  it("writes JSON lines to stderr and never to stdout", async () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    stderrLogger("info", "hello", { a: 1 });
    await createCanadaPostMcpServer({ config, client: ctx.client });
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    const lines = err.mock.calls.map((c) => String(c[0]));
    for (const line of lines) {
      const parsed = JSON.parse(line) as { level: string; event: string };
      expect(parsed.level).toBeDefined();
      expect(line).not.toContain(SECRET);
    }
    expect(lines.some((l) => l.includes("server_ready"))).toBe(true);
  });
});
