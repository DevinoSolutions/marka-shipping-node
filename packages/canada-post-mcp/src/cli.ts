#!/usr/bin/env node
/**
 * Command-line entry point (the package `bin`): a stdio MCP server for Canada Post. It logs
 * only to stderr, because stdout belongs to the MCP transport. Credentials are read from the
 * environment and never printed.
 */
import { pathToFileURL } from "node:url";
import { loadConfigFromEnv, McpConfigError } from "./config.js";
import {
  connectStdio,
  createCanadaPostMcpServer,
  McpStartupError,
  stderrLogger,
} from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

const USAGE = `${SERVER_NAME} ${SERVER_VERSION}: Canada Post MCP server (stdio)

Usage:
  canada-post-mcp            Start the server on stdio
  canada-post-mcp --help     Show this text
  canada-post-mcp --version  Show the version

Environment:
  CANADAPOST_CLIENT_ID, CANADAPOST_CLIENT_SECRET, CANADAPOST_CUSTOMER_NUMBER   required
  CANADAPOST_APP                       test (default) or production (typed out)
  CANADAPOST_MCP_ALLOW_WRITES          true to register the preview/apply write tools
  CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES  true as well, when CANADAPOST_APP is production
  CANADAPOST_MCP_PREVIEW_TTL_SECONDS   lifetime of a preview (default 300, max 900)
  CANADAPOST_MCP_PREVIEW_HMAC_KEY      integrity key of previews (random per process by default)
  CANADAPOST_MCP_OUTPUT_DIR            where labels are saved (absolute path; default: temp dir)
  CANADAPOST_MOBO, CANADAPOST_PLATFORM_ID   optional
`;

/** Parses the (tiny) command line. */
export function parseCliArgs(argv: readonly string[]): { help: boolean; version: boolean } {
  const unknown = argv.filter(
    (a) => a !== "--help" && a !== "-h" && a !== "--version" && a !== "-v",
  );
  if (unknown.length > 0) {
    throw new McpConfigError(`unknown argument: ${unknown[0] ?? ""}`);
  }
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    version: argv.includes("--version") || argv.includes("-v"),
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.error(USAGE);
    return;
  }
  if (args.version) {
    console.error(SERVER_VERSION);
    return;
  }
  const config = loadConfigFromEnv();
  const { server } = await createCanadaPostMcpServer({ config });
  await connectStdio(server);
  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    if (error instanceof McpConfigError || error instanceof McpStartupError) {
      stderrLogger("error", "startup_failed", { message: error.message });
    } else {
      stderrLogger("error", "startup_failed", { message: "unexpected error while starting" });
    }
    process.exit(1);
  });
}
