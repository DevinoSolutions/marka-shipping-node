# Changelog

All notable changes to `@joinmarka/canada-post` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `createCanadaPostRestClient`: an additional transport for the new Canada Post Developer Portal
  (REST/JSON, OAuth2 `client_credentials`). `shipments` (`create`, `get`, `getDetails`, `getPrice`,
  `list`, `getLabel`, `void`) and `rating` (`getPrices`, `listServices`, `getService`,
  `getOption`), typed from Canada Post's OpenAPI documents (kept in `docs/research/openapi/`).
  The XML client is unchanged.
- OAuth token provider: in-memory cache, refresh 60 s before expiry, single-flight, retries of the
  token request only. Tokens and the client secret never appear in errors, logs or debug events.
- Writes (`shipments.create`, `shipments.void`) are never retried or replayed after a 401; a
  timeout or gateway error is `CanadaPostIndeterminateError`. Reads retry 5xx/429 and replay once
  after a 401 with a fresh token.
- New errors: `CanadaPostAuthError` (token endpoint), `CanadaPostAccessDeniedError` (HTTP 403, with
  `emptyBody`), `CanadaPostTestAppRequiredError`.
- `app: "test" | "production"` is declared by the caller (default `"test"`, never read from the
  environment); `client.probeTestApp()` / `client.assertTestApp()` prove a Test app from behaviour.
- Live Test-app suite (`npm run test:live:test-app`, `CANADAPOST_TEST_APP_LIVE=true`) and the daily
  canary workflow `live-test-app.yml` (GitHub Environment `canada-post-test`). The guard
  (`check:live-readonly`) now allows writes only in `test/live-test-app/` and only behind
  `assertTestApp()`; it has its own tests. `check:secrets` also scans OAuth client ids/secrets,
  Bearer tokens, JWT-shaped values and label capability URLs.
- ADR 0002 and section 10 of the contracts document (REST wire shapes, Test-app behaviour,
  assumptions).

### Changed

- The Canada Post SDK is now published on its own as `@joinmarka/canada-post` (0.1.0). `@joinmarka/shipping` (0.2.0) is the Marka Shipping umbrella: it re-exports every carrier (`canadaPost` namespace plus the Canada Post API at the top level). Each package has its own release tag (`canada-post-vX.Y.Z`, `shipping-vX.Y.Z`).

### Fixed

- `ncShipments.create` no longer sends `country-code` in the sender address: the ncshipment-v4 schema types the sender as a domestic address, and the sandbox rejected it with HTTP 400. Every address type was re-checked against the XSDs (see the contracts doc).

### Changed

- `rating.getRates`, `ncShipments.create` and `shipments.create` validate their required fields and `destination.type` at runtime and throw `CanadaPostValidationError` before sending, instead of sending an incomplete request.

## [0.1.0] - 2026-11-07

### Added

- `createCanadaPostClient` with Basic auth, customer number, optional `mobo` and `contractId`,
  injectable `fetch`, timeouts, GET-only retries and a redacting `onDebug` hook. The default
  environment is the sandbox (`ct.soa-gw.canadapost.ca`); production must be requested.
- `rating`: `getRates`, `discoverServices`, `getService`, `getOption` (rate-v4).
- `ncShipments` (non-contract, ncshipment-v4): `create`, `get`, `getDetails`, `getReceipt`,
  `list`, `requestRefund`.
- `shipments` (contract, shipment-v8): `create`, `get`, `getDetails`, `getPrice`, `getReceipt`,
  `void`, `requestRefund`, `transmit`, `getGroups`, `list`.
- `manifests` (manifest-v8): `get`, `list`, `getDetails`.
- `artifacts`: `get` (PDF and ZPL as bytes, polls HTTP 202), `saveToFile`, `saveArtifact`.
- `tracking` (track-v2): `getSummary`, `getDetails` by PIN or DNC.
- `followLink` and `findLink` / `requireLink` helpers for Canada Post `link` elements.
- Typed errors: `CanadaPostApiError`, `CanadaPostTimeoutError`, `CanadaPostNetworkError`,
  `CanadaPostIndeterminateError`, `CanadaPostParseError`, `CanadaPostValidationError`,
  `CanadaPostConfigurationError`.
- `@joinmarka/canada-post/testing` with `createMockFetch`.
- Verified wire-shape contracts in `docs/research/canadapost-api-contracts.md`.
