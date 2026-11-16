# ADR 0003: REST full surface: how operations are classified, and card data never leaves the SDK

Status: accepted (2026-11-16). Extends ADR 0001 (indeterminate writes) and ADR 0002 (REST
transport and Test-app interlock).

## Context

The REST client started with Shipping and Rating. Canada Post's Developer Portal also offers
Tracking, Customer Information, Returns, Pickup, Post Office and Service Information, plus the
later Shipping endpoints (receipt, QR code, refund, groups, manifests). Some of them bill,
open tickets or consume labels; one of them (Customer Information) lists the credit cards on
file.

## Decisions

1. **Classify by effect, not by verb** (as before). Every REST operation is registered in
   `operations.ts`; the live-suite guard derives its forbidden list from the `write` entries.
   - Writes: `shipments.create`, `shipments.void`, `shipments.requestRefund` (opens a service
     ticket, `charges: false`), `shipments.transmit` (bills the shipments), `pickup.create`
     (can bill), `pickup.update` / `pickup.cancel` (`PUT` / `DELETE`, no charge),
     `returns.createAuthorized`, `returns.createOpen` (label billing), `returns.deleteOpen`.
   - `returns.getOpenArtifact` is a **GET that is a write**: "Retrieve Next Open Return
     Artifact" consumes one label of the template (`artifactsRemaining` goes down) and may bill
     it. It is never retried or replayed.
   - `tracking.createCertificate` is a **POST that is a read** (it renders a PDF; nothing is
     created or billed), like `rating.getPrices`.
2. **Writes keep ADR 0001**: sent once, never replayed after a `401`, a timeout or 502/503/504
   is `CanadaPostIndeterminateError` with a recovery hint naming the operation that finds the
   object again (`shipments.list`, `manifests.list`, `pickup.list`, `returns.listOpen`).
3. **Card data never leaves the SDK.** `customerInfo.creditCardAliases` is deleted on receipt.
   `customers.get()` keeps only `creditCardCount`; `customers.getPaymentReadiness()` returns
   `{ hasCreditCard, contracts, authorizedPayers, paymentMethods }`; `followLink` strips the key
   from any JSON it returns; every alias is registered with the secret redactor so it is
   scrubbed from error messages, body excerpts and debug events. The live test checks the
   absence of the key in the profile, in a followed link and in the debug events.
4. **Live coverage follows the Test app's subscriptions.** The Test app is subscribed to
   Shipping, Rating, Tracking and Customer Information only. Pickup, Returns, Post Office and
   Service Information have mocked and OpenAPI contract tests but no live tests; the gap is
   recorded in the contracts document (10.7) instead of a test that skips silently. The
   Test-app writes the app accepts (refund, manifest transmit) run in the live flow behind
   `assertTestApp()`.
5. **Vendor documents are kept verbatim.** The new OpenAPI documents are committed after
   removing example PII and sample ids (see `docs/research/openapi/README.md`); a known vendor
   bug (double-escaped patterns in the Post Office document) is repaired only in the test
   validator, and a test fails when the vendor fixes it.

## Consequences

- Adding an API means: types, an API class, an `operations.ts` entry with the correct
  `access`/`charges`/`http`, an OpenAPI contract mapping (`test/support/contract-services.ts`),
  mocked tests, and live tests only where the Test app is subscribed.
- A new write automatically becomes forbidden in `test/live/` and allowed only in
  `test/live-test-app/` (behind `assertTestApp()`) through the derived guard.
- Pickup, Returns and Post Office wire behaviour is unobserved: the open items in the contracts
  document list what is assumption.
