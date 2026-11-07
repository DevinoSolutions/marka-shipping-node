# Changelog

All notable changes to `@devino-solutions/canadapost-sdk` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- `@devino-solutions/canadapost-sdk/testing` with `createMockFetch`.
- Verified wire-shape contracts in `docs/research/canadapost-api-contracts.md`.
