// Shared setup of the MCP live TEST-APP smoke suite.
//
// It drives the real MCP server (in process, over a linked in-memory transport) against the
// real Canada Post Developer Portal using the credentials of a *Test* app (free, static stub
// answers, no postage). Write tools are enabled here, but only after `assertTestApp()` has
// proven that the credentials really belong to a Test app. `npm run check:live-readonly`
// enforces that every test file proves it in `beforeAll`, and that nothing in this directory
// can name the production credentials, the production app type or the legacy XML client.
//
// This module is the ONLY place a client and a server are built. It reads exactly three
// credential variables (plus the opt-in flag); every other line of `.env` is ignored.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCanadaPostRestClient, type CanadaPostRestClient } from "@joinmarka/canada-post";
import { loadConfigFromEnv } from "../../src/config.js";
import { createCanadaPostMcpServer } from "../../src/server.js";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");

/** Reads only the named keys from the repository `.env` (the file may hold other secrets). */
function readDotEnv(keys: readonly string[]): Record<string, string> {
  const file = join(repoRoot, ".env");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!keys.includes(key)) continue;
    out[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const fromFile = readDotEnv([
  "CANADAPOST_CLIENT_ID",
  "CANADAPOST_CLIENT_SECRET",
  "CANADAPOST_CUSTOMER_NUMBER",
]);
const clientId = process.env.CANADAPOST_CLIENT_ID ?? fromFile["CANADAPOST_CLIENT_ID"] ?? "";
const clientSecret =
  process.env.CANADAPOST_CLIENT_SECRET ?? fromFile["CANADAPOST_CLIENT_SECRET"] ?? "";
const customerNumber =
  process.env.CANADAPOST_CUSTOMER_NUMBER ?? fromFile["CANADAPOST_CUSTOMER_NUMBER"] ?? "";
const requested = process.env.CANADAPOST_TEST_APP_LIVE === "true";

// When the suite is requested, missing credentials FAIL the run instead of skipping it: a
// canary that silently skips would hide a broken pipeline.
if (requested && (clientId === "" || clientSecret === "" || customerNumber === "")) {
  throw new Error(
    "CANADAPOST_TEST_APP_LIVE=true but CANADAPOST_CLIENT_ID, CANADAPOST_CLIENT_SECRET and " +
      "CANADAPOST_CUSTOMER_NUMBER are not all set",
  );
}

/** The suite runs only when explicitly requested. */
export const liveEnabled = requested;

let cached: CanadaPostRestClient | undefined;

/** The Test-app client (built lazily and reused). The app type is hard-coded. */
export function testAppClient(): CanadaPostRestClient {
  cached ??= createCanadaPostRestClient({
    clientId,
    clientSecret,
    customerNumber,
    app: "test",
    timeoutMs: 60_000,
  });
  return cached;
}

/** The customer number of the Test app, for building request bodies. */
export function testCustomerNumber(): string {
  return customerNumber;
}

/** A request id that is unique per run (max 35 characters). */
export function uniqueRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(
    0,
    35,
  );
}

/** One MCP session: a client talking to an in-process server over linked memory transports. */
export interface McpSession {
  readonly toolNames: readonly string[];
  call(name: string, args?: Record<string, unknown>): Promise<{ isError: boolean; data: unknown }>;
  close(): Promise<void>;
}

/**
 * Opens a session on the Test-app client. `writes` registers the preview/apply write tools; the
 * server then runs its own startup proof of a Test app as well.
 */
export async function openMcpSession(writes: boolean): Promise<McpSession> {
  const config = loadConfigFromEnv({
    CANADAPOST_CLIENT_ID: clientId,
    CANADAPOST_CLIENT_SECRET: clientSecret,
    CANADAPOST_CUSTOMER_NUMBER: customerNumber,
    CANADAPOST_MCP_ALLOW_WRITES: writes ? "true" : "false",
  });
  const handle = await createCanadaPostMcpServer({
    config,
    client: testAppClient(),
    logger: () => undefined,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "canada-post-mcp-smoke", version: "0.0.0" });
  await Promise.all([handle.server.connect(serverSide), mcp.connect(clientSide)]);
  return {
    toolNames: handle.toolNames,
    async call(name, args = {}) {
      const result = await mcp.callTool({ name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0]?.text ?? "null";
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { isError: result.isError === true, data };
    },
    async close() {
      await mcp.close();
      await handle.server.close();
    },
  };
}
