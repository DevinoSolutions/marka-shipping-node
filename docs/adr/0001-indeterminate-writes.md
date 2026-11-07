# ADR 0001: Writes are never retried; ambiguous writes are indeterminate

Status: accepted (2026-11-07)

## Context

Creating a Canada Post shipment (and transmitting a manifest) bills postage in production.
The API has no idempotency key. A `POST` that times out, loses its connection, or is answered
by a gateway with 502/503/504 may or may not have been applied. Retrying it can create and
bill a second label.

## Decision

1. Only `GET` requests are ever retried, and only on HTTP 5xx and 429, with exponential backoff
   (honouring `Retry-After`, capped at 30 s). `POST` and `DELETE` are never retried, including the
   read-only `rating.getRates` quote (kept simple: one rule, no per-endpoint exceptions).
2. Operations that change state (`create`, `transmit`, `void`, `requestRefund`) are marked
   `mutating`. If one of them times out, fails with a network error, or receives 502/503/504,
   the SDK throws `CanadaPostIndeterminateError` (`reason`: `timeout`, `network` or `gateway`),
   not a plain timeout/network error. Its message says so and names the lookup to run first.
3. Other statuses (400, 403, 404, 500, and a `<messages>` body on HTTP 200) are definitive
   answers: the SDK throws `CanadaPostApiError`.
4. Recovery is the caller's decision, with SDK support:
   - contract shipments: `shipments.list({ requestId })` using the caller's
     `customerRequestId` (Canada Post rejects duplicate ids with code 7314), or
     `shipments.list({ groupId })`, or `shipments.list({ noManifest: true, date })`;
   - non-contract shipments: `ncShipments.list({ from, to })`;
   - transmit: `manifests.list({ start, end })` and `shipments.getGroups()`.
5. The `requestId` search answers HTTP 202 while a shipment is still being created; that is
   surfaced as `CanadaPostApiError` with `isPending === true`.

## Consequences

- A flaky network never double-bills silently; the cost is that callers must handle
  `CanadaPostIndeterminateError` explicitly.
- Treating 502/503/504 on a write as indeterminate is conservative: a gateway can answer 503
  before reaching the backend. Verifying first is cheap compared to a duplicate charge.
- **ASSUMPTION** (contracts doc §9): which statuses a gateway returns for a half-completed
  POST is not documented by Canada Post.
