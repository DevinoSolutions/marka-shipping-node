// Harness of the mocked MCP tests: a scripted Canada Post (SDK mock fetch) behind a real
// in-process MCP client/server pair. Everything is invented; no credential is real.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCanadaPostRestClient } from "@joinmarka/canada-post";
import {
  createMockFetch,
  type MockFetch,
  type MockReply,
  type RecordedRequest,
} from "@joinmarka/canada-post/testing";
import { loadConfigFromEnv, type McpConfig } from "../../src/config.js";
import { InMemoryPreviewStore } from "../../src/preview-store.js";
import { createCanadaPostMcpServer, type CanadaPostMcpServer } from "../../src/server.js";
import type { Logger } from "../../src/tools/shared.js";

export const BASE = "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs";
export const TOKEN_URL = `${BASE}/cpc-api-native-oauth-provider/oauth2/token`;
export const SECRET = "test-client-secret-value";
export const CLIENT_ID = "test-client-id";
export const ACCESS_TOKEN = "fake-access-token-1";
export const CUSTOMER = "1234567";
export const ACCOUNT = `${BASE}/shipping/v1/${CUSTOMER}/${CUSTOMER}`;

export const BASE_ENV: Record<string, string> = {
  CANADAPOST_CLIENT_ID: CLIENT_ID,
  CANADAPOST_CLIENT_SECRET: SECRET,
  CANADAPOST_CUSTOMER_NUMBER: CUSTOMER,
};

const JSON_HEADERS = { "content-type": "application/json" };

export function json(body: unknown, status = 200): MockReply {
  return { status, body: JSON.stringify(body), headers: JSON_HEADERS };
}

export const QUOTES = [
  {
    serviceCode: "DOM.EP",
    serviceName: "Expedited Parcel",
    serviceLink: {
      rel: "service",
      href: `${BASE}/rating/v1/services/DOM.EP`,
      mediaType: "application/json",
    },
    priceDetails: { base: 10, due: 11.5 },
    weightDetails: {},
    serviceStandard: { amDelivery: false, guaranteedDelivery: true, expectedTransitTime: 3 },
  },
];

export const LINK = (rel: string, path: string, mediaType = "application/json") => ({
  rel,
  href: `${ACCOUNT}${path}`,
  mediaType,
});

export function pdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
}

/** One scripted route. `reply` may be a function of the request. */
export interface Route {
  method: string;
  /** Matched against the URL (without the query string). */
  path: RegExp;
  reply: MockReply | ((request: RecordedRequest) => MockReply);
}

export interface HarnessOptions {
  env?: Record<string, string>;
  routes?: Route[];
  now?: () => number;
  /** Files go here (a temp directory) unless the env sets an output dir. */
  outputDir?: string;
  previewStore?: InMemoryPreviewStore;
}

export interface Harness {
  mcp: Client;
  handle: CanadaPostMcpServer;
  config: McpConfig;
  mock: MockFetch;
  logs: Array<{ level: string; event: string; fields?: Record<string, unknown> | undefined }>;
  store: InMemoryPreviewStore;
  clock: { now: number };
  /** Requests to Canada Post other than token requests, in order. */
  apiRequests(): RecordedRequest[];
  /** Calls a tool and returns the parsed JSON of its text content. */
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ isError: boolean; data: Record<string, unknown> }>;
  toolNames(): Promise<string[]>;
  close(): Promise<void>;
}

/** The default reply of every route the tests do not script: a JSON 404, like the gateway. */
const NOT_SCRIPTED = json(
  { httpCode: "404", httpMessage: "Not Found", moreInformation: "no such route in the test" },
  404,
);

/**
 * Builds the server with a scripted Canada Post. The two `POST /rating/v1/prices` answers are
 * identical canned bytes, so `assertTestApp()` passes (as it does against a real Test app).
 */
export async function makeHarness(options: HarnessOptions = {}): Promise<Harness> {
  const env = { ...BASE_ENV, ...options.env };
  if (options.outputDir !== undefined && env.CANADAPOST_MCP_OUTPUT_DIR === undefined) {
    env.CANADAPOST_MCP_OUTPUT_DIR = options.outputDir;
  }
  const config = loadConfigFromEnv(env);
  const routes: Route[] = [
    { method: "POST", path: /\/rating\/v1\/prices$/, reply: json(QUOTES) },
    ...(options.routes ?? []),
  ];
  const mock = createMockFetch((request) => {
    if (request.url === TOKEN_URL) {
      return json({
        token_type: "Bearer",
        access_token: ACCESS_TOKEN,
        scope: "merchant",
        expires_in: 3600,
      });
    }
    const path = request.url.split("?")[0] ?? request.url;
    for (const route of routes) {
      if (route.method === request.method && route.path.test(path)) {
        return typeof route.reply === "function" ? route.reply(request) : route.reply;
      }
    }
    return NOT_SCRIPTED;
  });
  const client = createCanadaPostRestClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    customerNumber: config.customerNumber,
    app: config.app,
    fetch: mock.fetch,
    retryDelayMs: 0,
  });
  const logs: Harness["logs"] = [];
  const logger: Logger = (level, event, fields) => {
    logs.push({ level, event, fields });
  };
  const clock = { now: 1_800_000_000_000 };
  const store = options.previewStore ?? new InMemoryPreviewStore();
  const handle = await createCanadaPostMcpServer({
    config,
    client,
    logger,
    previewStore: store,
    now: options.now ?? (() => clock.now),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([handle.server.connect(serverTransport), mcp.connect(clientTransport)]);
  return {
    mcp,
    handle,
    config,
    mock,
    logs,
    store,
    clock,
    apiRequests: () => mock.requests.filter((r) => r.url !== TOKEN_URL),
    async call(name, args = {}) {
      const result = await mcp.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? "{}";
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Input validation errors from the MCP layer are plain text.
        data = { message: text };
      }
      return { isError: result.isError === true, data };
    },
    async toolNames() {
      const { tools } = await mcp.listTools();
      return tools.map((t) => t.name).sort();
    },
    async close() {
      await mcp.close();
      await handle.server.close();
    },
  };
}
