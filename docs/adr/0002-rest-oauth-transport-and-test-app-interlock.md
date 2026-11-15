# ADR 0002: REST/OAuth transport next to the XML client, and the Test-app interlock

Status: accepted (2026-11-15)

## Context

Canada Post's new Developer Portal serves JSON over OAuth2 (`client_credentials`) and issues
two kinds of apps that share one host and one token URL:

- a **Test** app: free, answers static stubs and ignores the request payload;
- a **Production** app: real rates and real, billed postage.

The SDK cannot tell the two apart from the URL. A live test suite that creates and voids
shipments is valuable (it exercises the real gateway, OAuth and the label download) but must
never be able to run those writes with Production credentials.

## Decision

1. **Additional transport, not a replacement.** `createCanadaPostRestClient` lives in
   `src/rest/` and shares errors, link helpers, the debug event type and the operations table
   with the XML client. The XML client is unchanged.
2. **Token handling.** The OAuth token is cached in memory, refreshed 60 s before expiry and
   fetched single-flight. Only the token request is retried (network error, timeout, 429, 5xx):
   it is idempotent. Rejected credentials (4xx) are definitive. Tokens and the client secret
   never appear in errors, debug events or logs (`SecretRedactor`).
3. **Writes keep ADR 0001.** `shipments.create` and `shipments.void` are sent once. A 401 on a
   write drops the rejected token but is not replayed; a timeout, dropped connection or
   502/503/504 is `CanadaPostIndeterminateError`. Reads retry 5xx/429 and replay once after a
   401 with a fresh token. A token failure happens before anything is sent and is definitive
   (`CanadaPostAuthError`).
4. **The caller declares the app.** `app: "test" | "production"` (default `"test"`) is never
   read from an environment variable inside the SDK (the same rule as `environment` for the
   XML client).
5. **`assertTestApp()` is the interlock.** It sends two quote requests that differ in every
   input and passes only if both answers are HTTP 200 price lists and are byte-identical.
   Anything else (different bodies, errors, empty lists, identical error pages, a client
   declared `"production"`) throws `CanadaPostTestAppRequiredError`.
6. **Guards.** `test/live/` stays read-only and XML-sandbox-only. `test/live-test-app/` may
   write only because `scripts/check-live-readonly.ts` requires every test file there to
   `await ...assertTestApp()` in a `beforeAll` before its first test, to take its client from
   `setup.ts` (the only place a client is built, hard-coded to `app: "test"`), to read no
   environment variable beyond the opt-in flag and the three Test-app credentials, and to be
   unable to name the production credentials, the production app type, the legacy XML client or
   raw network access. The guard derives what is a write from `operations.ts` and fails on a
   vacuous pass; `scripts/live-guard.test.ts` proves it rejects what it claims to.
7. **CI.** `.github/workflows/live-test-app.yml` runs the suite from a GitHub Environment
   (`canada-post-test`) that holds only the Test app's credentials. Missing secrets fail the
   job; a scheduled failure opens an issue and a green scheduled run closes it.

## Consequences

- A leaked or misconfigured credential pair can only cause a live write if it passes a
  behavioural proof that a Production app is designed to fail.
- The live suite depends on the Test app keeping its stub behaviour; if Canada Post changes
  it, the canary fails loudly and the failure is the signal (see the contracts doc, section 10).
- **ASSUMPTION:** a Production app never returns byte-identical bodies for the two probe
  quotes. It would need identical prices for different zones, weights and services.
