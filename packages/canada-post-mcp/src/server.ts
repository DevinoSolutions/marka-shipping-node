/**
 * The MCP-SDK-touching layer: builds the server, decides whether write tools exist, and adapts
 * the pure tool definitions into `registerTool` calls. Tool logic lives in `tools/`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";
import { createCanadaPostRestClient, type CanadaPostRestClient } from "@joinmarka/canada-post";
import { describeConfig, writePolicy, type McpConfig, type WritePolicy } from "./config.js";
import { InMemoryPreviewStore, type PreviewStore } from "./preview-store.js";
import { READ_TOOLS } from "./tools/read.js";
import {
  outputSchema,
  scrubText,
  type Logger,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from "./tools/shared.js";
import { WRITE_TOOLS } from "./tools/write.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

/** Raised when the server must not start (for example the Test-app proof failed). */
export class McpStartupError extends Error {}

/** Writes JSON lines to stderr. stdout belongs to the stdio transport. */
export const stderrLogger: Logger = (level, event, fields) => {
  console.error(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
};

export interface CreateServerOptions {
  readonly config: McpConfig;
  /** Injected in tests; built from the configuration otherwise. */
  readonly client?: CanadaPostRestClient;
  readonly previewStore?: PreviewStore;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface CanadaPostMcpServer {
  readonly server: McpServer;
  /** Names of the registered tools. */
  readonly toolNames: readonly string[];
  readonly writes: WritePolicy;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  if (!result.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(result.error, null, 2) }],
    };
  }
  // Round-trip through JSON so the structured object is pure JSON (no undefined).
  const structured = JSON.parse(JSON.stringify(result.structuredContent)) as Record<
    string,
    unknown
  >;
  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
  };
}

function register(server: McpServer, definition: ToolDefinition, ctx: ToolContext): void {
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema as z.ZodType,
      outputSchema: outputSchema as z.ZodType,
      annotations: definition.annotations,
    },
    async (args) => {
      try {
        return toCallToolResult(await definition.handler(args as never, ctx));
      } catch (error) {
        // Handlers map their own errors; this is the last line of defense.
        ctx.logger("error", "tool_crashed", {
          tool: definition.name,
          message: scrubText(error instanceof Error ? error.message : String(error), ctx.config),
        });
        return toCallToolResult({
          ok: false,
          error: { errorCode: "internal", message: "internal error" },
        });
      }
    },
  );
}

/**
 * Builds the server. Read tools are always registered. Write tools (previews and apply) are
 * registered only when `CANADAPOST_MCP_ALLOW_WRITES=true` (and, for a Production app,
 * `CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES=true`). With a Test app, writes additionally need
 * `assertTestApp()` to pass once at startup: credentials declared as a Test app that turn out
 * to be anything else stop the server instead of enabling writes.
 */
export async function createCanadaPostMcpServer(
  options: CreateServerOptions,
): Promise<CanadaPostMcpServer> {
  const { config } = options;
  const logger = options.logger ?? stderrLogger;
  const client =
    options.client ??
    createCanadaPostRestClient({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      customerNumber: config.customerNumber,
      app: config.app,
      ...(config.mobo === undefined ? {} : { mobo: config.mobo }),
      ...(config.platformId === undefined ? {} : { platformId: config.platformId }),
    });
  const writes = writePolicy(config);

  if (config.allowWrites && !writes.enabled) {
    logger("warn", "writes_disabled", { reason: writes.reason });
  }
  if (writes.enabled && config.app === "test") {
    try {
      await client.assertTestApp();
    } catch (error) {
      throw new McpStartupError(
        "Refusing to enable write tools: the credentials did not prove to be a Canada Post Test " +
          `app (${scrubText(error instanceof Error ? error.message : String(error), config)}). ` +
          "Fix the credentials, or set CANADAPOST_APP=production deliberately.",
      );
    }
    logger("info", "test_app_verified", {});
  }
  if (writes.enabled && config.app === "production") {
    logger("warn", "production_writes_enabled", {
      notice: "write tools can charge REAL postage on this account",
    });
  }

  const ctx: ToolContext = {
    client,
    config,
    previewStore: options.previewStore ?? new InMemoryPreviewStore(),
    logger,
    now: options.now ?? Date.now,
  };
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const definitions = writes.enabled ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS];
  for (const definition of definitions) register(server, definition, ctx);
  logger("info", "server_ready", { ...describeConfig(config), tools: definitions.length });
  return { server, toolNames: definitions.map((d) => d.name), writes };
}

/** Connects a server to stdio. The transport owns stdout. */
export async function connectStdio(server: McpServer): Promise<StdioServerTransport> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}
