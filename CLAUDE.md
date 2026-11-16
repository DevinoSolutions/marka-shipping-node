# CLAUDE.md — agent instructions for this repo

TypeScript monorepo: `packages/canada-post` (`@joinmarka/canada-post`, the SDK) and
`packages/shipping` (`@joinmarka/shipping`, the Marka Shipping umbrella that re-exports every carrier;
no logic of its own). Each package has its own release tag (`canada-post-vX.Y.Z`, `shipping-vX.Y.Z`). npm workspaces,
ESM/NodeNext, Node >= 22.12. A community SDK for the Canada Post Developer Program REST APIs
(XML with versioned vendor media types). Not affiliated with Canada Post.

## Hard rules (safety — never break these)

1. **Never create, void, transmit or request a refund against PRODUCTION** (SDK call, curl,
   probe script, example) without the owner explicitly authorizing that specific action in the
   current session. In production `shipments.create`, `shipments.transmit` and
   `ncShipments.create` charge real postage, and so do the REST client's `shipments.create`,
   `shipments.transmit`, `pickup.create`, `returns.createAuthorized`, `returns.createOpen` and
   `returns.getOpenArtifact` with a Production app (refunds open a service ticket). Sandbox (`environment: "development"`) and the Developer Portal
   **Test** app are fine. Never use the Production app credentials
   (`CANADAPOST_PROD_CLIENT_ID`/`_SECRET`) for anything, not even a token request, without that
   authorization.
2. **There are two live suites, and exactly one of them may write.**
   - `packages/canada-post/test/live/` (XML sandbox) is **READ-ONLY and SANDBOX-ONLY**. Never add
     a mutating call (`create`, `void`, `transmit`, `requestRefund`, any raw POST/DELETE) and never
     reference the production environment there.
   - `packages/canada-post/test/live-test-app/` (REST/OAuth **Test app**: static stubs, no
     postage) may create and void shipments **only because** every test file awaits
     `assertTestApp()` in a `beforeAll` before its first test, which refuses unless two very
     different quotes come back byte-identical. Nothing in that directory may reference
     `PROD`/`CANADAPOST_PROD_*`, the `"production"` app type, the legacy XML client or its
     environments, raw network access, or any environment variable except
     `CANADAPOST_TEST_APP_LIVE`, `CANADAPOST_CLIENT_ID`, `CANADAPOST_CLIENT_SECRET` and
     `CANADAPOST_CUSTOMER_NUMBER`. `setup.ts` is the only place a client is built and it
     hard-codes `app: "test"`. Only Test-app credentials ever go into the `canada-post-test`
     GitHub Environment.
     `npm run check:live-readonly` enforces both and derives its forbidden list from
     `packages/canada-post/src/operations.ts` — to extend it, add the operation to that table with
     `access: "write"`; do not weaken the guard to make a test pass (`scripts/live-guard.test.ts`
     proves what it rejects; extend it with the guard). `test/operations.test.ts` fails if a public
     method is missing from the table.
3. **Secrets stay in `.env`.** Never print, log, commit or hardcode credentials or values
   derived from them (including `base64(username:password)` and the Zonos key). Real customer
   numbers, contract ids, PINs and addresses stay out of the repo too; fixtures use fake
   values only. Enforced by `npm run check:secrets`, which scans the WORKING TREE — keep it
   that way.
4. **The default environment is the sandbox, the default app is the Test app.** Production
   must always be an explicit choice by the caller (`environment: "production"` for the XML
   client, `app: "production"` for the REST client); never default to it, never read it from an
   env var inside the SDK.
5. **Writes are never auto-retried.** Only idempotent GETs retry (5xx/429); the REST client also
   replays a GET once after a 401 with a fresh token, never a write. A timeout, dropped
   connection or 502/503/504 on a write is `CanadaPostIndeterminateError` — see
   `docs/adr/0001-indeterminate-writes.md`. Adding a retry loop around a write is how a label
   gets billed twice.
6. Credentials only ever travel in the `Authorization` header (and the Zonos key header), and
   the OAuth client id/secret only to the token endpoint. OAuth tokens and client secrets never
   appear in errors, logs or debug events (`SecretRedactor`). Links returned by Canada Post may
   only be followed on the configured environment host (REST: `api.canadapost-postescanada.ca`
   under `/prod/devportal-portaildesdeveloppeurs/`).
7. **No AI/assistant attribution anywhere**: not in commits, code, docs or PR text.

## Binding contracts

- `docs/research/canadapost-api-contracts.md` — verified wire shapes (method, path, media type
  and version, request/response XML, error codes), each cited to the official page and date.
  When adding an endpoint, extend it from the official docs first and mark gaps
  **ASSUMPTION**. Read the markers before debugging a 4xx.
- `docs/research/openapi/*.json` — Canada Post's OpenAPI documents for the REST APIs; section 10
  of the contracts doc records where the Test app deviates from them. The contract tests validate
  against them.
- `docs/adr/` — indeterminate writes (0001), REST/OAuth transport and the Test-app interlock
  (0002). Follow them.

## Toolchain pins (do not upgrade without owner sign-off)

TypeScript `~6.0.3` · vitest `^4` · ESLint flat config + typescript-eslint · knip `5.88.1` ·
typedoc with `treatWarningsAsErrors` · fast-xml-parser is the only runtime dependency (the
REST client adds none).

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
CANADAPOST_TEST_APP_LIVE=true npm run test:live:test-app   # REST Test-app suite, may write (needs
                         # CANADAPOST_CLIENT_ID/_SECRET/CUSTOMER_NUMBER of the TEST app in .env)
```

All of these must exit 0 before claiming work is done. Trust exit codes, not output prettiness.

## Environment gotchas (primary dev machine: Windows + OneDrive)

- OneDrive can silently roll `dist/` back to stale artifacts and can inject NUL bytes into a
  source file. After `npm run build`, confirm dist mtimes are newer than src before trusting
  dist-dependent checks; bizarre `tsc` parse errors at 1:1 -> check for NUL bytes.
- The REST client's `docs:api` and `verify:exports` need a fresh `npm run build` first.
- Prefer the Bash tool for long commands. A killed long-running PowerShell command can wedge
  that session.
