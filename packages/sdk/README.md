# @devino-solutions/canadapost-sdk

A community TypeScript SDK for the [Canada Post Developer Program](https://www.canadapost-postescanada.ca/information/app/drc/home) REST APIs: rating, non-contract and contract shipping, manifests, labels (PDF and ZPL) and tracking.

> **Not affiliated with Canada Post.** This is an independent, community-maintained SDK. "Canada Post" and related marks belong to Canada Post Corporation. Always check the [official documentation](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/default.jsf) for the authoritative behaviour of the API.

- Typed, camelCase inputs and outputs mapped to and from Canada Post's XML. The parsed XML stays available on every response (`raw`) for fields the SDK does not map.
- Follows Canada Post's `link` elements with the correct versioned media type.
- Robust parsing: lists that arrive as one object or an array, numbers sent as strings, `<messages>` error bodies (even on HTTP 200).
- Safe by default: **sandbox environment unless you ask for production**, GET-only retries, writes are never retried, and an ambiguous shipment creation is reported as _indeterminate_ instead of being silently retried (and billed twice).
- One small runtime dependency (`fast-xml-parser`), built-in `fetch` (injectable), Node 22.12+.

## Install

```bash
npm install @devino-solutions/canadapost-sdk
```

## Environments and money (read this first)

|                                | Host                              | Notes                                                               |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------- |
| `"development"` (**default**)  | `https://ct.soa-gw.canadapost.ca` | Sandbox. Validates your schema; responses are not real data.        |
| `"production"` (explicit only) | `https://soa-gw.canadapost.ca`    | **Creating a shipment or transmitting a manifest charges postage.** |

- Use a _development_ API key with the sandbox and a _production_ key with production. A mismatch returns HTTP 403 (`AA002`).
- Test the calls that cost nothing first (rating, tracking). In production, `shipments.create` followed by `shipments.transmit`, `shipments.create` with `transmitShipment: true`, and `ncShipments.create` all bill real postage.
- If you create test shipments in production, void them (`shipments.void`) before transmitting.

## Quick start

```ts
import { createCanadaPostClient } from "@devino-solutions/canadapost-sdk";

const canadaPost = createCanadaPostClient({
  username: process.env.CANADAPOST_USERNAME!,
  password: process.env.CANADAPOST_PASSWORD!,
  customerNumber: process.env.CANADAPOST_CUSTOMER_NUMBER!,
  // contractId: "...",            // contract customers only
  // mobo: "...",                  // mailing on behalf of another customer
  // environment: "production",    // default is "development" (sandbox)
});
```

### 1. Get a rate quote (sandbox, free)

```ts
const { quotes } = await canadaPost.rating.getRates({
  originPostalCode: "K2B8J6",
  destination: { type: "domestic", postalCode: "J0E1X0" },
  parcel: { weightKg: 1, dimensionsCm: { length: 20, width: 15, height: 10 } },
});

for (const q of quotes) {
  console.log(q.serviceCode, q.priceDetails.due, q.serviceStandard.expectedDeliveryDate);
}
```

Other rating calls: `rating.discoverServices({ country })`, `rating.getService("DOM.EP")`, `rating.getOption("SO")`.

### 2. Create a non-contract shipment and download the label

Non-contract shipping is for customers without a commercial contract; the credit card saved on your Canada Post profile is charged (in production).

```ts
import { findLink } from "@devino-solutions/canadapost-sdk";

const shipment = await canadaPost.ncShipments.create({
  serviceCode: "DOM.EP",
  sender: {
    company: "Example Co",
    contactPhone: "555-555-5555",
    address: {
      addressLine1: "100 Example Street",
      city: "Ottawa",
      provState: "ON",
      postalZipCode: "K1A0B1",
    },
  },
  destination: {
    name: "Jane Example",
    address: {
      addressLine1: "200 Sample Avenue",
      city: "Toronto",
      provState: "ON",
      postalZipCode: "M5V2T6",
    },
  },
  parcel: { weightKg: 1.2, dimensionsCm: { length: 20, width: 15, height: 10 } },
  preferences: { showPackingInstructions: true },
});

console.log(shipment.shipmentId, shipment.trackingPin);

// Follow the label link: PDF (or ZPL for thermal printers).
const labelLink = findLink(shipment.links, "label")!;
const label = await canadaPost.artifacts.get(labelLink); // { contentType, data: Uint8Array }
await canadaPost.artifacts.saveToFile(labelLink, "./label.pdf");
```

`artifacts.get` returns raw bytes, so ZPL works the same way (`new TextDecoder().decode(label.data)`). Right after creation the label may still be rendering (HTTP 202); the SDK polls a few times for you.

### 3. Track a parcel

```ts
const summary = await canadaPost.tracking.getSummary({ pin: "1234567890123456" });
const detail = await canadaPost.tracking.getDetails({ pin: "1234567890123456" });
// or by Delivery Notice Card number: { dnc: "315052413796541" }
```

In the sandbox every tracking query answers "No Pin History" (a `CanadaPostApiError` with code `004`); use production PINs in production to test the full range.

### Contract shipping and manifests

```ts
const created = await canadaPost.shipments.create({
  customerRequestId: "order-1001", // makes a lost create recoverable, see below
  groupId: "2030-01-15-warehouse",
  requestedShippingPoint: "K2B8J6",
  cpcPickupIndicator: true,
  serviceCode: "DOM.EP",
  sender: {/* ... */},
  destination: {/* ... */},
  parcel: { weightKg: 2 },
  preferences: { showPackingInstructions: true },
});

await canadaPost.shipments.void(created.links.find((l) => l.rel === "self")!); // before transmit only

const { manifestLinks } = await canadaPost.shipments.transmit({
  groupIds: ["2030-01-15-warehouse"],
  requestedShippingPoint: "K2B8J6",
  cpcPickupIndicator: true,
  manifestAddress: { company: "Example Co", phoneNumber: "555 555 5555", address: {/* ... */} },
});
const manifest = await canadaPost.manifests.get(manifestLinks[0]!); // may be pending, see below
await canadaPost.artifacts.saveToFile(manifest.artifactLink!, "./manifest.pdf");
```

### Following links yourself

Every response keeps its `links`. `canadaPost.followLink(link)` performs a GET with the link's own `media-type` as `Accept` and returns either the parsed XML (`{ kind: "xml", raw, text }`) or bytes (`{ kind: "binary", data, contentType }`). Links must point at the configured environment host, so credentials never leave it.

## API surface

| Namespace     | Methods                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `rating`      | `getRates`, `discoverServices`, `getService`, `getOption`                                                         |
| `ncShipments` | `create`, `get`, `getDetails`, `getReceipt`, `list`, `requestRefund`                                              |
| `shipments`   | `create`, `get`, `getDetails`, `getPrice`, `getReceipt`, `void`, `requestRefund`, `transmit`, `getGroups`, `list` |
| `manifests`   | `get`, `list`, `getDetails`                                                                                       |
| `artifacts`   | `get`, `saveToFile`                                                                                               |
| `tracking`    | `getSummary`, `getDetails`                                                                                        |
| `client`      | `followLink`, `environment`, `baseUrl`                                                                            |

Versioned media types: rating `application/vnd.cpc.ship.rate-v4+xml`, non-contract `application/vnd.cpc.ncshipment-v4+xml`, contract `application/vnd.cpc.shipment-v8+xml`, manifests `application/vnd.cpc.manifest-v8+xml`, tracking `application/vnd.cpc.track-v2+xml`.

Client options: `username`, `password`, `customerNumber`, `mobo?`, `contractId?`, `environment?`, `fetch?`, `timeoutMs?` (30 s), `retries?` (2), `retryDelayMs?` (250), `language?` (`en-CA`/`fr-CA`), `onDebug?`.

Not covered yet: reference-number tracking, signatures and delivery certificates, Find a Post Office, Pickup, Returns, merchant registration, SOAP. See [docs/research/canadapost-api-contracts.md](https://github.com/DevinoSolutions/canadapost-sdk-node-js/blob/main/docs/research/canadapost-api-contracts.md) for the verified wire shapes and every assumption.

## Error handling

Everything the SDK throws extends `CanadaPostError`.

```ts
import {
  CanadaPostApiError,
  CanadaPostIndeterminateError,
  CanadaPostNetworkError,
  CanadaPostTimeoutError,
} from "@devino-solutions/canadapost-sdk";

try {
  await canadaPost.rating.getRates(input);
} catch (err) {
  if (err instanceof CanadaPostApiError) {
    console.error(err.status, err.codes, err.descriptions, err.requestId);
    if (err.hasCode("9111")) {
      /* no service fits this parcel */
    }
    if (err.isPending) {
      /* HTTP 202: not ready, poll again */
    }
  } else if (err instanceof CanadaPostTimeoutError || err instanceof CanadaPostNetworkError) {
    // a read or a quote: safe to repeat
  } else if (err instanceof CanadaPostIndeterminateError) {
    // a write may or may not have happened, see below
  }
}
```

- `CanadaPostApiError` carries the HTTP `status`, every message `code`/`description` from the `<messages>` body, and a request id if the gateway sent one. Canada Post sometimes returns a business-rule failure with HTTP 200; the SDK throws for those too.
- Retries: only idempotent `GET`s are retried, on HTTP 5xx and 429, with exponential backoff (honouring `Retry-After`). `POST` and `DELETE` are **never** retried, not even the read-only `getRates` quote.
- Credentials are only sent in the `Authorization` header. They never appear in errors, and the optional `onDebug` hook receives headers with `Authorization` redacted.

### Indeterminate creates (read this before retrying)

If a `create`, `transmit`, `void` or refund request **times out, loses its connection, or hits a 502/503/504**, the server may have processed it, and in production a created label may already be billed. The SDK throws `CanadaPostIndeterminateError` and does not retry. Before you try again, look the object up:

```ts
try {
  await canadaPost.shipments.create({ customerRequestId: "order-1001", groupId: "g1" /* ... */ });
} catch (err) {
  if (err instanceof CanadaPostIndeterminateError) {
    // Contract shipments: search by the id you chose, by group, or by day.
    const byId = await canadaPost.shipments.list({ requestId: "order-1001" });
    const byGroup = await canadaPost.shipments.list({ groupId: "g1" });
    const today = await canadaPost.shipments.list({ noManifest: true, date: new Date() });
    // Non-contract shipments: search by creation time (Eastern time).
    const recent = await canadaPost.ncShipments.list({ from: new Date(Date.now() - 15 * 60_000) });
    // Only create again if none of them contains the shipment.
  }
}
```

Always set `customerRequestId` on contract shipments (Canada Post rejects duplicates with code `7314`): it makes the recovery search exact and protects against double creation. A `requestId` search that answers HTTP 202 means the shipment is still being created; poll again.

## Testing your own code

```ts
import { createMockFetch } from "@devino-solutions/canadapost-sdk/testing";

const mock = createMockFetch({ status: 200, body: "<price-quotes/>" });
const client = createCanadaPostClient({ /* ... */ fetch: mock.fetch });
```

## Development

```bash
npm install
npm run build && npm test
```

Live sandbox smoke tests are opt-in and strictly read-only (quotes, discovery, tracking): copy `.env.example` to `.env`, then `CANADAPOST_LIVE_TESTS=true npm run test:live`. The suite refuses to run unless the environment is `development`. See [CONTRIBUTING.md](https://github.com/DevinoSolutions/canadapost-sdk-node-js/blob/main/CONTRIBUTING.md).

## Official Canada Post documentation

- [Developer Program home](https://www.canadapost-postescanada.ca/information/app/drc/home) (sign up and get API keys)
- [Service directory](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/default.jsf)
- [REST fundamentals](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/fundamentals.jsf)
- [Rating](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/rating/default.jsf) · [Non-contract shipping](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/onestepshipping/default.jsf) · [Contract shipping](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/shippingmanifest/default.jsf) · [Tracking](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/tracking/default.jsf)
- [Official code samples](https://www.canadapost.ca/cpo/mc/business/productsservices/developers/codesamples.jsf), [API throttle limits](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/throttlelimits.jsf), [release notes](https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/versioning.jsf)

## License

MIT, copyright Devino Solutions.
