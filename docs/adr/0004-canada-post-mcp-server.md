# ADR 0004: The Canada Post MCP server: opt-in writes, preview then apply

Status: accepted (2026-11-16). Builds on ADR 0001 (indeterminate writes), ADR 0002 (Test-app
interlock) and ADR 0003 (operation classification, card data). Mirrors the preview/apply design of
the sibling Newegg MCP server (its ADR 0005).

## Context

An assistant that can call Canada Post can buy postage. Quotes and tracking are harmless; creating
a shipment, transmitting a manifest, booking a pickup or creating a return label is not, and
Production is billed. A model must not be able to do those things by accident, on a stale idea of
what was agreed, or by repeating a call.

## Decisions

1. **Separate package, REST client only.** `@joinmarka/canada-post-mcp` depends on
   `@joinmarka/canada-post` and uses only the REST/OAuth client. `@modelcontextprotocol/sdk` and
   `zod` belong to this package and are not added to the SDK (the SDK stays dependency-free).
2. **Tools are a pure layer.** `src/tools/` holds plain async handlers and zod input schemas and
   does not import the MCP SDK; `src/server.ts` adapts them. Handlers are unit-testable without a
   client, and the MCP wiring is a few lines.
3. **Read tools always, write tools by opt-in.** 20 read tools are always registered. The 8 write
   tools (7 previews and `canadapost_apply`) are registered only when
   `CANADAPOST_MCP_ALLOW_WRITES=true`; for `CANADAPOST_APP=production` also
   `CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES=true`. Not registered means not callable: there is no
   runtime "writes are off" error to argue with. `CANADAPOST_APP` must be exactly `test` or
   `production`; booleans must be exactly `true` or `false`.
4. **Test-app proof before writes.** With a Test app and writes enabled the server runs
   `assertTestApp()` once at startup and fails closed (`McpStartupError`) if it does not hold.
   The credentials are declared, not detected (ADR 0002): this proves the declaration.
5. **Preview then apply, one apply tool.** A preview validates the input, stores the exact
   request, and returns a token. `canadapost_apply` takes only `{ confirmToken }`: the request
   cannot be altered after the user saw it. The token is 256 random bits, sealed with an
   HMAC-SHA256 over the canonical (key-sorted) JSON of `{ id, kind, request, createdAt,
expiresAt, app, customerNumber }`, so a record is bound to the app and account it was made
   for; it is single use, lives 300 seconds by default (30 to 900), is kept in memory only (a
   restart invalidates every preview), at most 100 are pending, and a bounded memory of used ids
   answers a replay with `preview_already_used`.
6. **Failed applies consume the token.** A write is never replayed: an ambiguous failure is
   `indeterminate` (with the SDK's recovery text and the `customerRequestId`), a rejection is
   `api_error`, and in both cases the user must preview again. This matches ADR 0001.
7. **Production is loud.** Previews state `mayCharge` and the mode; applies state `charged` and,
   in Production, that real postage or fees were charged. Whether an operation charges comes
   from the SDK operations table, not from a list kept here.
8. **Labels go to disk, not through the channel.** The label tool saves the artifact and returns a
   path: it requires an absolute path with the right extension, is confined to
   `CANADAPOST_MCP_OUTPUT_DIR` when set, and never overwrites.
9. **No card data, no secrets.** Customer information is returned as a payment-readiness summary
   (ADR 0003). Tool errors come from the SDK's already-redacted messages, scrubbed again; stderr
   JSON lines never contain credentials, tokens or link capability query values; stdout is never
   written to. The `CANADAPOST_PROD_*` variables are never read.
10. **A smoke canary.** A live suite drives the real server in process against the Test app (list
    tools, quote, track, create then void through preview and apply). It sits behind the same
    guard as the SDK's live suite (`npm run check:live-readonly`): its `setup.ts` is the only
    place a client or server is built, the client is the literal `app: "test"`, and every test
    file awaits `assertTestApp()` in `beforeAll`.

## Consequences

- Adding a write tool means adding it to `WRITE_TOOLS` with a preview, an `OperationKind`, and an
  `execute` case; its charging behaviour follows the operations table.
- The server cannot resume a preview after a restart. That is deliberate.
- Pickup, Returns, Post Office and Service Information are not subscribed on the Test app
  (ADR 0003): their tools are covered by mocked tests only.
