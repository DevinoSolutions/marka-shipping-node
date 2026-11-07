# CLAUDE.md — agent instructions for this repo

TypeScript monorepo: `packages/sdk` (`@devino-solutions/canadapost-sdk`), npm workspaces,
ESM/NodeNext, Node >= 22.12. A community SDK for the Canada Post Developer Program REST APIs
(XML with versioned vendor media types). Not affiliated with Canada Post.

## Hard rules (safety — never break these)

1. **Never create, void, transmit or request a refund against PRODUCTION** (SDK call, curl,
   probe script, example) without the owner explicitly authorizing that specific action in the
   current session. In production `shipments.create`, `shipments.transmit` and
   `ncShipments.create` charge real postage. Sandbox (`environment: "development"`) is fine.
2. **The live test suite is READ-ONLY and SANDBOX-ONLY.** Files in `packages/sdk/test/live/`
   use real sandbox credentials. Never add a mutating call (`create`, `void`, `transmit`,
   `requestRefund`, any raw POST/DELETE) and never reference the production environment there.
   `npm run check:live-readonly` enforces this and derives its forbidden list from
   `packages/sdk/src/operations.ts` — to extend it, add the operation to that table with
   `access: "write"`; do not weaken the guard to make a test pass. `test/operations.test.ts`
   fails if a public method is missing from the table.
3. **Secrets stay in `.env`.** Never print, log, commit or hardcode credentials or values
   derived from them (including `base64(username:password)` and the Zonos key). Real customer
   numbers, contract ids, PINs and addresses stay out of the repo too; fixtures use fake
   values only. Enforced by `npm run check:secrets`, which scans the WORKING TREE — keep it
   that way.
4. **The default environment is the sandbox.** Production must always be an explicit choice
   by the caller; never default to it, never read it from an env var inside the SDK.
5. **Writes are never auto-retried.** Only idempotent GETs retry (5xx/429). A timeout, dropped
   connection or 502/503/504 on a write is `CanadaPostIndeterminateError` — see
   `docs/adr/0001-indeterminate-writes.md`. Adding a retry loop around a write is how a label
   gets billed twice.
6. Credentials only ever travel in the `Authorization` header (and the Zonos key header).
   Links returned by Canada Post may only be followed on the configured environment host.
7. **No AI/assistant attribution anywhere**: not in commits, code, docs or PR text.

## Binding contracts

- `docs/research/canadapost-api-contracts.md` — verified wire shapes (method, path, media type
  and version, request/response XML, error codes), each cited to the official page and date.
  When adding an endpoint, extend it from the official docs first and mark gaps
  **ASSUMPTION**. Read the markers before debugging a 4xx.
- `docs/adr/` — indeterminate writes (0001). Follow them.

## Toolchain pins (do not upgrade without owner sign-off)

TypeScript `~6.0.3` · vitest `^4` · ESLint flat config + typescript-eslint · knip `5.88.1` ·
typedoc with `treatWarningsAsErrors` · fast-xml-parser is the only runtime dependency.

## Conventions

- Strict TS everywhere (`noUncheckedIndexedAccess` — index access yields `T | undefined`).
- `any` is banned (`@typescript-eslint/no-explicit-any: error`); use `unknown` + narrowing.
- Relative imports in `src/` carry `.js` extensions (ESM NodeNext).
- No `console.*` in `packages/*/src` except `console.error`. Tests/scripts may log.
- Canada Post wire quirks are the norm: every XML list can be one object or an array
  (`asArray`), numbers and ids arrive as text (leading zeros matter, parse numbers explicitly),
  empty elements parse as `""` (read as `undefined`), business-rule errors can come back with
  HTTP 200 and a `<messages>` body, and the docs contain typos (`expected-transmit-time`,
  POST printed for GET). Reuse `src/xml/parse.ts`, `src/xml/build.ts` and `src/http.ts` — never
  hand-roll parsing, and always build request XML with `leaf`/`wrap` so text is escaped.
- Classify operations by what they do, not by HTTP verb: `rating.getRates` is a POST that only
  quotes; `shipments.void` is a DELETE that mutates.
- The request XML schemas use `xsd:all`, so element order does not matter.

## Commands

```bash
npm run build            # tsc
npm run typecheck        # scripts + workspace
npm run lint / format:check
npm test                 # mocked suites; no credentials needed
npm run check:secrets
npm run check:live-readonly
npm run check:deadcode   # knip
npm run docs:api         # typedoc, warnings are errors
npm run verify:exports   # requires a fresh build
npm run pack:dry
CANADAPOST_LIVE_TESTS=true npm run test:live   # READ-ONLY sandbox smoke tests (needs .env)
```

All of these must exit 0 before claiming work is done. Trust exit codes, not output prettiness.

## Environment gotchas (primary dev machine: Windows + OneDrive)

- OneDrive can silently roll `dist/` back to stale artifacts and can inject NUL bytes into a
  source file. After `npm run build`, confirm dist mtimes are newer than src before trusting
  dist-dependent checks; bizarre `tsc` parse errors at 1:1 -> check for NUL bytes.
- Prefer the Bash tool for long commands. A killed long-running PowerShell command can wedge
  that session.
