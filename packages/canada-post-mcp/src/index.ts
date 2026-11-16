/**
 * `@joinmarka/canada-post-mcp`: a stdio Model Context Protocol server for Canada Post, built on
 * `@joinmarka/canada-post`. Run it with the `canada-post-mcp` binary; this module exposes the
 * building blocks for embedding and testing.
 */
export {
  describeConfig,
  loadConfigFromEnv,
  McpConfigError,
  writePolicy,
  type McpApp,
  type McpConfig,
  type WritePolicy,
} from "./config.js";
export {
  InMemoryPreviewStore,
  type ConsumeResult,
  type OperationKind,
  type PreviewRecord,
  type PreviewStore,
} from "./preview-store.js";
export type { Logger, LogLevel } from "./tools/shared.js";
export {
  connectStdio,
  createCanadaPostMcpServer,
  McpStartupError,
  type CanadaPostMcpServer,
  type CreateServerOptions,
} from "./server.js";
export { SERVER_NAME, SERVER_VERSION } from "./version.js";
