# Canada Post REST API contracts (verified wire shapes)

Binding contract for `packages/sdk`. The code follows this document. Every section cites the
official page it was transcribed from and the date it was read (**2026-11-07**). Anything that
could not be confirmed from the official pages is marked **ASSUMPTION**.

Base of all service pages:
`https://www.canadapost-postescanada.ca/info/mc/business/productsservices/developers/services/`
(abbreviated `…/services/` below). Schemas: `https://www.canadapost-postescanada.ca/cpc/doc/en/business/developers/xsd/{common,messages,rating,shipment,ncshipment,manifest,track}.xsd`
(read 2026-11-07).

## 1. Common conventions

Source: `…/services/fundamentals.jsf` (read 2026-11-07).

### Hosts

| Environment           | Host                              |
| --------------------- | --------------------------------- |
| Development (sandbox) | `https://ct.soa-gw.canadapost.ca` |
| Production            | `https://soa-gw.canadapost.ca`    |

The environment is selected by BOTH the host and the API key: a development key used against
production (or vice versa) returns `403` with code `AA002`. The sandbox "validates your schema
only" — responses do not contain valid data (tracking PIN `123456789012`, po-number
`P123456789`, no `rel="receipt"` link, labels stamped "for testing purposes only", every
tracking query answers "No Pin History"). Production shipment creation is billed.

### Authentication

`Authorization: Basic base64(apiUserId:apiPassword)` on every request (the "API key" is the
`userid:password` pair). `GET`, `POST` and `DELETE` all carry it.

### Headers

| Header            | Applies to                        | Value                                                                                   |
| ----------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `Accept`          | every call                        | the service media type (below). `*/*` is rejected.                                      |
| `Content-Type`    | POST bodies                       | the same media type as `Accept`. `*/*` is rejected.                                     |
| `Accept-Language` | optional                          | `en-CA` or `fr-CA`; language of human readable error messages and names.                |
| `If-None-Match`   | optional GET                      | ETag from a prior response; `304` means unchanged. Not used by the SDK.                 |
| `X-CPC-Zonos-Key` | create shipment (NC and contract) | Zonos account key; only for US-bound shipments submitted without a `us-declaration-id`. |

Provided-link calls (§2) copy the link's `media-type` attribute into `Accept`.

### Media types and versions

| Service group              | Media type (Accept and Content-Type)    | XML namespace                                |
| -------------------------- | --------------------------------------- | -------------------------------------------- |
| Rating (v4)                | `application/vnd.cpc.ship.rate-v4+xml`  | `http://www.canadapost.ca/ws/ship/rate-v4`   |
| Non-contract shipping (v4) | `application/vnd.cpc.ncshipment-v4+xml` | `http://www.canadapost.ca/ws/ncshipment-v4`  |
| Contract shipping (v8)     | `application/vnd.cpc.shipment-v8+xml`   | `http://www.canadapost.ca/ws/shipment-v8`    |
| Manifests (v8)             | `application/vnd.cpc.manifest-v8+xml`   | `http://www.canadapost.ca/ws/manifest-v8`    |
| Tracking (v2)              | `application/vnd.cpc.track-v2+xml`      | `http://www.canadapost.ca/ws/track` (XSD)    |
| Artifacts                  | `application/pdf` or `application/zpl`  | n/a (binary)                                 |
| Errors                     | root element `messages`                 | `http://www.canadapost.ca/ws/messages` (XSD) |

Versions are "Current version" per `…/services/versioning.jsf` (read 2026-11-07): Rating 4,
Contract Shipping 8, Non-Contract Shipping 4, Tracking 2, Manifest 8.

### Links

Source: `fundamentals.jsf` "Provided endpoints". Responses carry

```xml
<link rel="{rel}" href="{absolute URL}" media-type="{media type}" index="{n}"/>
```

Rules: use the `href` as given (never parse or rebuild it), send the `media-type` as `Accept`,
use HTTP `GET` — except `rel="self"` of a shipment which is also the `DELETE` (void) target,
and `rel="refund"` which is a `POST`. `index` appears on formatted-output links (labels) and
starts at `0` (`1` in one contract prose paragraph; the SDK just echoes it).

Known `rel` values: `self`, `details`, `receipt`, `price`, `refund`, `label`, `returnLabel`,
`commercialInvoice`, `codRemittanceLabel`, `codRecordOfDelivery`, `codRemittanceReturnLabel`,
`group`, `shipment`, `ncShipment`, `manifest`, `manifestShipments`, `artifact`, `service`,
`option`, `publicLabel`, `publicKeyInfo`.

### Throttling

Source: `…/developers/throttlelimits.jsf` (read 2026-11-07). Per-group, per API key, rolling
60 s window, e.g. "Create Shipment … at least 250 ms of delay between calls" under the upgraded
limit. Exceeding it returns an error whose code is `Server` and description
`Rejected by SLM Monitor`. The SDK does not rate-limit on its own. **ASSUMPTION**: the HTTP
status of a throttle rejection is `429` or `4xx`; the SDK treats `429` as retryable for GETs.

### Error body

Source: `fundamentals.jsf` "Error message structure"; `messages.xsd`.

```xml
<messages>
  <message>
    <code>7007</code>
    <description>The weight value is invalid. …</description>
  </message>
</messages>
```

`code` and `description` are both required, `message` repeats 0..n. A single `message` parses
as an object, several as an array.

| HTTP | Meaning (from fundamentals)                                                                                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200  | success. **Create Shipment (contract) and Get Shipment Receipt can return an application error in a `200` body** (`messages` root instead of the success structure) — the SDK checks the root element, not only the status. |
| 202  | "try later": resource not ready (e.g. label ~1 s after Create Non-Contract Shipment; Get Manifest code `9153`; Get Shipments by `requestId`).                                                                               |
| 204  | success without body (Void Shipment).                                                                                                                                                                                       |
| 304  | not modified (only with `If-None-Match`).                                                                                                                                                                                   |
| 400  | schema failure (`code = "Server"`) or business rule (numeric code).                                                                                                                                                         |
| 401  | bad API key.                                                                                                                                                                                                                |
| 403  | `AA001` key deactivated, `AA002` wrong environment key, `AA003` key does not match mailed-by customer, `AA004` cannot mail on behalf of customer.                                                                           |
| 404  | wrong path / expired resource (artifacts, shipments, manifests expire after 90 days).                                                                                                                                       |
| 406  | unsupported `Accept` version.                                                                                                                                                                                               |
| 412  | precondition failed ("unexpected error"; retry after a short time).                                                                                                                                                         |
| 415  | unsupported `Content-Type` version.                                                                                                                                                                                         |
| 500  | XML/schema error per message.                                                                                                                                                                                               |

Request id: **ASSUMPTION** — Canada Post documents no request-id header. The SDK reads
`x-request-id`, `x-correlation-id` or `x-correlationid` if a gateway returns one and otherwise
leaves `requestId` undefined.

### Path variables

`{customer}` = mailed-by customer number, `{mobo}` = mailed-on-behalf-of customer number, or the
customer number repeated when not mailing on behalf of anyone. Query strings cannot contain
blanks (use `%20`).

### Sandbox test credentials (documented by Canada Post)

`fundamentals.jsf` "Test values for contract shipping, rating and returns" publishes a shared
sandbox customer number, contract id and API key for non-contract developers. **They are
intentionally NOT reproduced in this repository** (the secret scanner forbids credential-shaped
literals); read them on that page.

## 2. Rating — `application/vnd.cpc.ship.rate-v4+xml`

Sources: `…/services/rating/getrates/default.jsf` (Get Rates), `…/getrates/discoverservices.jsf`,
`…/getrates/getservices.jsf`, `…/getrates/getoption.jsf`; `rating.xsd` (all read 2026-11-07).

### Get Rates

`POST {host}/rs/ship/price` — `Content-Type` and `Accept` = rating-v4. Read-only quote (no
charge).

Request root `mailing-scenario` (ns `…/ws/ship/rate-v4`), children (XSD `all`, order is free):

| Element                        | Req   | Notes                                                                                                         |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------- |
| `customer-number`              | cond. | needed for discounted/contract rates; omit for counter rates                                                  |
| `contract-id`                  | cond. | with `customer-number` for commercial rates; omit for Solutions for Small Business / general business         |
| `promo-code`                   | opt   |                                                                                                               |
| `quote-type`                   | opt   | `commercial` (default) or `counter`                                                                           |
| `expected-mailing-date`        | opt   | `YYYY-MM-DD`                                                                                                  |
| `options/option*` (≤20)        | opt   | `option-code` (`SO`,`COV`,`COD`,`PA18`,`PA19`,`HFP`,`DNS`,`LAD`), `option-amount` (COV)                       |
| `parcel-characteristics`       | req   | `weight` (kg), `dimensions{length,width,height}` (cm), `unpackaged`, `mailing-tube`, `oversized`              |
| `services/service-code*` (≤20) | opt   | omit → all applicable services rated                                                                          |
| `origin-postal-code`           | req   | `ANANAN`, uppercase                                                                                           |
| `destination`                  | req   | exactly one of `domestic/postal-code`, `united-states/zip-code`, `international/{country-code, postal-code?}` |

Response root `price-quotes/price-quote*`:
`service-code`, `service-link[@rel,@href,@media-type]`, `service-name`,
`price-details{base, taxes{gst,pst,hst (+@percent)}, due, options/option*{option-code,
option-name, option-price, qualifier{step-size,step-cost,included-amount,max-value,included,
percent}}, adjustments/adjustment*{adjustment-code, adjustment-name, adjustment-cost,
qualifier/percent}}`, `weight-details{cubed-weight?}` (often empty),
`service-standard{am-delivery, guaranteed-delivery, expected-transit-time,
expected-delivery-date}`.

Errors (400): `1622` expected-mailing-date in the past, `7050` option prerequisite, `9111` no
service appropriate, `9112` service not available for country/customer/contract.

### Discover Services

`GET {host}/rs/ship/service?country={cc}&contract={contract-id}&origpc={pc}&destpc={pc}` — all
query params optional; `Accept` = rating-v4. `destpc` requires `origpc`.
Response `services/service*{service-code, service-name, link[@rel="service",@href,@media-type]}`.
Errors: `2550` contract invalid, `7266` postal code format, `8534` country required, `9194`
origpc required with destpc.

The doc's sample response omits the opening `<services>` tag; the XSD and prose define it. The
parser tolerates `services` as an object or array and a single `service` as an object.

### Get Service

Follow the `rel="service"` link (or construct `GET {host}/rs/ship/service/{service-code}?country={cc}`
— **ASSUMPTION** for the constructed form; it is taken from the link examples
`…/rs/ship/service/DOM.EP?country=CA`). Response `service{service-code, service-name, comment?,
options/option*{option-code, option-name, link[@rel="option"], mandatory, qualifier-required,
qualifier-max?}, restrictions{weight-restriction[@min,@max] (grams),
dimensional-restrictions{length|width|height[@min,@max], length-plus-girth-max,
length-height-width-sum-max, oversize-limit}, density-factor, can-ship-in-mailing-tube,
can-ship-unpackaged, allowed-as-return-service}}`. Error `8534`.

### Get Option

Follow the `rel="option"` link, or construct `GET {host}/rs/ship/option/{option-code}` (sample
`GET https://XX/rs/ship/option/SO`). Response `option{option-code, option-name,
option-class (FEAT|DI|NDI), prints-on-label, qualifier-required, conflicting-options/option-code*,
prerequisite-options/option-code*}`. Only error: `404`.

## 3. Non-contract shipping — `application/vnd.cpc.ncshipment-v4+xml`

Sources: `…/services/onestepshipping/createshipment.jsf`, `onestepshipment.jsf`,
`onestepshipments.jsf`, `shipmentdetails.jsf`, `shipmentreceipt.jsf`, `shipmentrefund.jsf`;
`ncshipment.xsd`; contract/NC differences from the Get Artifact page `shippingmanifest/shipmentartifact.jsf`
(all read 2026-11-07).

For customers without a commercial contract (pay by the credit card saved on the profile).
Production calls charge the card immediately.

### Create Non-Contract Shipment

`POST {host}/rs/{customer}/ncshipment` — Accept/Content-Type = ncshipment-v4; optional
`X-CPC-Zonos-Key`.

Request root `non-contract-shipment` (ns `…/ws/ncshipment-v4`), XSD `all`:

- `requested-shipping-point` (opt, `ANANAN`): required when the parcel is not picked up at the sender postal code.
- `delivery-spec` (req):
  - `service-code` (req) `DOM.RP|DOM.EP|DOM.XP|DOM.PC|USA.XP|USA.EP|USA.SP.AIR|USA.TP|USA.TP.LVM|INT.IP.AIR|INT.IP.SURF|INT.XP|INT.SP.AIR|INT.SP.SURF|INT.TP`
  - `sender` (req): `name?`, `company` (≤44), `contact-phone` (≤25), `address-details{address-line-1, address-line-2?, city, prov-state, country-code, postal-zip-code}` — sender must be domestic.
  - `destination` (req): `name?`, `company?`, `additional-address-info?`, `client-voice-number?` (required for USA.EP/XP/TP, INT.XP/TP and D2PO), `address-details{address-line-1, address-line-2?, city?, prov-state?, country-code, postal-zip-code?}`; at least one of name/company when shipping abroad.
  - `options/option*` (≤20): `option-code`, `option-amount?`, `option-qualifier-1?` (bool), `option-qualifier-2?` (≤12). Codes `SO COV COD PA18 PA19 HFP DNS LAD D2PO` + non-delivery `RASE RTS ABAN`.
  - `parcel-characteristics` (req): `weight` (kg, 3.3), `dimensions{length,width,height}` (cm, 3.1; required unless `document`), `document?`, `unpackaged?`, `mailing-tube?`.
  - `notification?`: `email`, `on-shipment`, `on-exception`, `on-delivery` (all required when present).
  - `preferences` (req): `show-packing-instructions` (req), `show-postage-rate?`, `show-insured-value?`.
  - `references?`: `cost-centre?`, `customer-ref-1?`, `customer-ref-2?`.
  - `customs?` (required for non-domestic): `currency`, `conversion-from-cad?`, `reason-for-export` (`DOC SAM REP SOG OTH`), `other-reason?`, `duties-and-taxes-prepaid?`, `certificate-number?`, `licence-number?`, `invoice-number?`, `ioss-id?`, `us-declaration-id?`, `sku-list/item*` (≤500: `customs-number-of-units`, `customs-description`, `sku?`, `hs-tariff-code?`, `unit-weight`, `customs-value-per-unit`, `customs-unit-of-measure?`, `country-of-origin?`, `province-of-origin?`).
  - `settlement-info?`: `promo-code?` (the NC page also lists `cod-remittance`; **not mapped by this SDK**).
- `create-public-key?`, `create-qr-code?` (bool; PDF 8.5x11 only; add `publicLabel` / `publicKeyInfo` links).

Response root `non-contract-shipment-info{shipment-id, tracking-pin?, links/link*}`; links
`self`, `details`, `receipt` (not in sandbox), `label` (`media-type="application/pdf"`,
`index="0"`), `refund`, `commercialInvoice`, `publicLabel`, `publicKeyInfo`.

Errors: `1459`, `1719`, `7272`, `7282`, `7289`, `7322` (400).
Fetch the label with Get Artifact; a `202` or `404` can be returned for ~1 s after creation
("a delay of approximately one second is required before you can retrieve the shipping label").

### Get Non-Contract Shipment

Follow `rel="self"` (create) or `rel="ncShipment"`/`rel="shipment"` (list). Constructed form
`{host}/rs/{customer}/ncshipment/{shipment-id}`. The documentation page prints the verb as
`POST`; fundamentals states that all provided-endpoint calls "require an HTTP GET method, and
do not require an XML body". **ASSUMPTION**: the SDK uses `GET` (documented typo).
Response identical to create. `404` after 90 days.

### Get Non-Contract Shipment Details

Link `rel="details"` → `{host}/rs/{customer}/ncshipment/{shipment-id}/details` (**ASSUMPTION**
`GET`, same typo). Response `non-contract-shipment-details{final-shipping-point, tracking-pin?,
delivery-spec{… same shape as the request, plus optional `recipient` for D2PO},
refund-request-info?{service-ticket-date, service-ticket-id}}`.

### Get Non-Contract Shipment Receipt

`GET {host}/rs/{customer}/ncshipment/{shipment-id}/receipt` (link `rel="receipt"`).
Response `non-contract-shipment-receipt{final-shipping-point, shipping-point-name,
shipping-point-id, mailed-by-customer, service-code, rated-weight, base-amount, pre-tax-amount,
gst-amount, pst-amount, hst-amount, priced-options?/priced-option*{option-code, option-price},
adjustments?/adjustment*{adjustment-code, adjustment-amount}, cc-receipt-details{merchant-name?,
merchant-url?, name-on-card?, auth-code, auth-timestamp, card-type, charge-amount, currency,
transaction-type}, service-standard{am-delivery, guaranteed-delivery, expected-transit-time,
expected-delivery-date}}`.

### Get Non-Contract Shipments

`GET {host}/rs/{customer}/ncshipment?from=YYYYMMDDHHMM&to=YYYYMMDDHHMM&trackingPIN={pin}`.
`to` defaults to now; dates are Eastern time; `trackingPIN` replaces from/to ("only one of from
and tracking PIN", error `9196`). Response `non-contract-shipments/link*` with
`rel="shipment"` (the page prose calls it `ncShipment`; the SDK accepts any rel). Empty result
→ `200` with an empty `non-contract-shipments`. Errors `9105`, `9116`, `9196`.

### Request Non-Contract Shipment Refund

`POST` to the `rel="refund"` link; Accept/Content-Type ncshipment-v4. Constructed form
**ASSUMPTION**: `{host}/rs/{customer}/ncshipment/{shipment-id}/refund` (the page only describes
following the link). Body:

```xml
<non-contract-shipment-refund-request xmlns="http://www.canadapost.ca/ws/ncshipment-v4">
  <email>name@example.ca</email>
</non-contract-shipment-refund-request>
```

Response `non-contract-shipment-refund-request-info{service-ticket-date, service-ticket-id}`.
Errors `7292` (already requested), `7296` (retry later), `404` bad id. Only valid for unused,
unscanned labels.

## 4. Contract shipping — `application/vnd.cpc.shipment-v8+xml`

Sources: `…/services/shippingmanifest/createshipment.jsf`, `shipment.jsf`, `shipments.jsf`,
`shipmentdetails.jsf`, `shipmentprice.jsf`, `shipmentreceipt.jsf`, `shipmentrefund.jsf`,
`voidshipment.jsf`, `groups.jsf`; `shipment.xsd` (read 2026-11-07).

### Create Shipment

`POST {host}/rs/{customer}/{mobo}/shipment` — Accept/Content-Type shipment-v8; optional
`X-CPC-Zonos-Key`. Root `shipment` (ns `…/ws/shipment-v8`), XSD `all`:

- `customer-request-id?` (≤35, unique — duplicates rejected with `7314`; use it so a lost create can be found again).
- exactly one of `group-id` (≤32) **or** `transmit-shipment` (`true`; charges immediately, cannot be voided, no transmit needed).
- `quickship-label-requested?`, `cpc-pickup-indicator?`, `requested-shipping-point?` (`ANANAN`), `shipping-point-id?` (4 chars; mutually exclusive with `requested-shipping-point`, one required), `expected-mailing-date?`, `provide-pricing-info?`, `provide-receipt-info?`, `create-public-key?`, `create-qr-code?`.
- `delivery-spec` (req): `service-code`, `sender` (company, contact-phone required), `destination`, `options?`, `parcel-characteristics` (`weight`, `dimensions?`, `unpackaged?`, `mailing-tube?`, `oversized?`), `notification?`, `print-preferences?{output-format (8.5x11|4x6), encoding (PDF|ZPL; ZPL needs 4x6)}`, `preferences` (`show-packing-instructions` req), `references?`, `customs?`, `settlement-info` (req: `paid-by-customer?`, `contract-id?`, `cif-shipment?`, `intended-method-of-payment` req = `CreditCard|Account|SupplierAccount`, `promo-code?`).
- not mapped by this SDK: `return-spec`, `pre-authorized-payment`, COD remittance.

Response root `shipment-info{customer-request-id?, shipment-id, shipment-status (created|transmitted|suspended), tracking-pin?, return-tracking-pin?, po-number?, shipment-price?, shipment-receipt?, links}`. Links: `self`, `details`, `group`, `price`, `receipt`, `refund` (no-manifest shipments), `label` (`index`), `returnLabel`, `commercialInvoice`, COD links, `publicLabel`, `publicKeyInfo`.

The process is not finished until **Transmit Shipments** is called, unless `transmit-shipment` was
used. Application errors arrive as a `messages` body, **HTTP 200**: `1156 1157 1159 1459 1702
1711 1719 7230 7282 7285 7288 7289 7290 7311–7317 7322 9186–9191`.

### Get Shipment

Follow `rel="self"` / `rel="shipment"`; constructed `GET {host}/rs/{customer}/{mobo}/shipment/{shipment-id}`
(from the sample). Response identical to create (plus `refund` / `price` / `receipt` links).
`404` after 90 days.

### Get Shipment Details / Price / Receipt

`GET …/shipment/{id}/details` → `shipment-details{customer-request-id?, shipment-status,
final-shipping-point, tracking-pin?, po-number?, shipping-point-id?, cpc-pickup-indicator?,
shipment-detail{group-id|transmit-shipment, quickship-label-requested?, expected-mailing-date?,
delivery-spec{…}, return-spec?, refund-request-info?}}`.
`GET …/shipment/{id}/price` → `shipment-price{service-code, base-amount, priced-options?, adjustments?,
pre-tax-amount, gst-amount, pst-amount, hst-amount, due-amount, service-standard{am-delivery,
guaranteed-delivery, expected-transmit-time (sic; "should be expected-transit-time"),
expected-delivery-date}, rated-weight}`. The SDK accepts both spellings.
`GET …/shipment/{id}/receipt` → `shipment-receipt{cc-receipt-details|supplier-account-receipt-details}`
(application errors can arrive as `200`).

### Void Shipment

`DELETE` the shipment `rel="self"` link (or constructed `…/shipment/{id}`), Accept = link media
type. Success `204`, no body. Errors: `404` (unknown or already voided), `8064` (already
transmitted — request a refund instead).

### Request Shipment Refund

`POST` the `rel="refund"` link; Accept/Content-Type shipment-v8; body
`<shipment-refund-request xmlns="http://www.canadapost.ca/ws/shipment-v8"><email>…</email></shipment-refund-request>`;
response `shipment-refund-request-info{service-ticket-date, service-ticket-id}`. Constructed form
**ASSUMPTION**: `…/shipment/{id}/refund`. Only for transmitted / no-manifest shipments with a
spoiled or unused label.

### Get Groups

`GET {host}/rs/{customer}/{mobo}/group` — Accept shipment-v8. Response `groups/group*{link[@rel="group"],
group-id}`. Empty groups persist up to 24 h. Errors `AA003`, `404` (no groups).

### Get Shipments

`GET {host}/rs/{customer}/{mobo}/shipment?<one search>`:

- `groupid={group-id}` — the `rel="group"` link from Get Groups/Create is `…/shipment?groupid=…`; the sample request spells it `groupId`. **ASSUMPTION**: the query name is case-insensitive; the SDK sends `groupid` (matching the link).
- `trackingPIN={pin}`, `requestId={customer-request-id}`,
- `noManifest=true&date=YYYYMMDD&limit={n}` (default today / 100 / max 99,999),
- plus optional `provideShipmentInfo=true` (≤100 results).
- or follow a `rel="group"` / `rel="manifestShipments"` link.

Response `shipments/link*[@rel="shipment"]` (or `shipment-info*` with `provideShipmentInfo`).
`404` if none or the group/manifest is gone; **`202`** if `requestId` matches a shipment still
being created (poll). Errors `9183`, `9185`.

## 5. Manifests — `application/vnd.cpc.manifest-v8+xml`

Sources: `…/shippingmanifest/transmitshipments.jsf`, `manifest.jsf`, `manifests.jsf`,
`manifestdetails.jsf`; `manifest.xsd` (read 2026-11-07).

### Transmit Shipments

`POST {host}/rs/{customer}/{mobo}/manifest`, Accept/Content-Type manifest-v8. Root `transmit-set`
(ns `…/ws/manifest-v8`), XSD `all`: `customer-request-id?` ("future use"), `group-ids/group-id+`
(req), `cpc-pickup-indicator?`, `requested-shipping-point?`, `shipping-point-id?` (one of the two
required), `detailed-manifests` (req bool), `method-of-payment` (req, `CreditCard|Account|SupplierAccount`),
`manifest-address` (req: `manifest-name?`, `manifest-company`, `phone-number`,
`address-details{address-line-1, address-line-2?, city, prov-state, country-code (CA|US), postal-zip-code}`),
`customer-reference?` (≤12), `excluded-shipments/shipment-id*`.
Response `manifests/link*[@rel="manifest"]`. Errors `7313 7317 9118 9119 9122 9186–9189`.
Limits: ≤30 groups per request recommended (50 hard, `9109`), ≤10,000 shipments (`9108`/`9110`).
Transmit bills the shipments.

### Get Manifest

Follow `rel="manifest"`. Constructed `GET {host}/rs/{customer}/{mobo}/manifest/{id}`. Response
`manifest{customer-request-id?, po-number, links/link*}` with `self`, `artifact`, `details`,
`manifestShipments`. `202`/`9153` transmit still running; `412`/`9154` transmit failed; `400`
`1182`/`1185` authorization failed; `200`-body `1653`.

### Get Manifests

`GET {host}/rs/{customer}/{mobo}/manifest?start=YYYYMMDD&end=YYYYMMDD` (`end` defaults to today).
Response `manifests/link*[@rel="manifest"]`; empty → `200`. Errors `9105`, `9116`.

### Get Manifest Details

Link `rel="details"` → `…/manifest/{id}/details` (`404` after 90 days or for empty manifests).
Response `manifest-details{po-number, final-shipping-point, shipping-point-name, shipping-point-id,
cpc-pickup-indicator?, mailed-by-customer, mailed-on-behalf-of, paid-by-customer, customer-ref?,
manifest-date, manifest-time, contract-id?, method-of-payment, cc-receipt-details?,
supplier-account-receipt-details?, manifest-pricing-info{base-cost, automation-discount,
options-and-surcharges, gst, pst, hst, total-due-cpc}, manifest-address}`.

## 6. Artifacts

Source: `shippingmanifest/shipmentartifact.jsf` (read 2026-11-07).

`GET` a `rel="label"|"returnLabel"|"commercialInvoice"|"artifact"|…` link whose href contains
`/rs/artifact` or `/ers/artifact`. `Accept: application/pdf` or `application/zpl` (the link's
`media-type`). Response is the raw PDF or ZPL II bytes. The same label (same barcode) is
returned on each call; `404` after 90 days (5 days for authorized-return labels). `202`/`404`
shortly after creation: not rendered yet. **ASSUMPTION**: the response `Content-Type` is
`application/pdf` / `application/zpl`; the SDK returns whatever header is sent and falls back to
the requested type.

## 7. Tracking — `application/vnd.cpc.track-v2+xml`

Sources: `…/services/tracking/trackingsummary.jsf`, `trackingdetails.jsf`; `track.xsd`
(read 2026-11-07). Read-only; no charge. Sandbox: always "No Pin History".

| Call                 | Request                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary by PIN       | `GET {host}/vis/track/pin/{pin}/summary` (PIN of 12, 13 or 16 characters)                                                                                       |
| Summary by DNC       | `GET {host}/vis/track/dnc/{dnc}/summary` (15 digits)                                                                                                            |
| Summary by reference | `GET {host}/vis/track/ref/summary?mailingDateFrom=…&mailingDateTo=…&referenceNumber=…[&customerNumber=][&destinationPostalCode=]` — **not implemented in v0.1** |
| Details by PIN / DNC | `GET {host}/vis/track/pin/{pin}/detail`, `…/dnc/{dnc}/detail`                                                                                                   |

Headers: `Accept: application/vnd.cpc.track-v2+xml` only.

Summary response `tracking-summary/pin-summary*{pin, origin-postal-id, destination-postal-id,
destination-province, service-name, mailed-on-date, expected-delivery-date, actual-delivery-date,
delivery-option-completed-ind (0|1|2), event-date-time (`yyyymmdd:hhmmss`), event-description,
attempted-date, customer-ref-1, customer-ref-2, return-pin, event-type, event-location,
signatory-name}` — empty elements are common and mean "unknown". PIN/DNC queries return one
`pin-summary`.

Details response `tracking-detail{pin, active-exists, archive-exists, changed-expected-date,
destination-postal-id, expected-delivery-date, changed-expected-delivery-reason,
mailed-by-customer-number, mailed-on-behalf-of-customer-number, original-pin, service-name,
service-name-2, customer-ref-1, customer-ref-2, return-pin, signature-image-exists,
suppress-signature, delivery-options/item*{delivery-option, delivery-option-description},
significant-events/occurrence*{event-identifier, event-date, event-time, event-time-zone,
event-description, signatory-name, event-site, event-province, event-retail-location-id,
event-retail-name}, cod-remit-info?{pin, type}}`. The doc sample uses `item` for events in one
example and `occurrence` in the other (and contains a mismatched `<service-name>…</service-type>`
tag); the XSD says `occurrence`. The SDK accepts both `occurrence` and `item`.

Errors: `002` Duplicate PIN, `004` No PIN History (and for reference searches `006`, `008`).
**ASSUMPTION**: these are delivered in the standard `messages` structure; if a tracking body is
instead `<tracking-summary>` / `<tracking-detail>` carrying `code`/`description` fields, the SDK
surfaces them through `raw` untouched.

## 8. Not covered by v0.1

Reference-number tracking, signature image, delivery confirmation certificate, Find a Post
Office, Deliver to Post Office, Pickup, Returns (authorized/open), AddressComplete, e-commerce
merchant registration, Service Info, COD remittance, `return-spec`, `pre-authorized-payment`,
public-key info calls, credit-status calls, SOAP.

## 9. Open items (everything marked ASSUMPTION above)

1. HTTP verb for Get Non-Contract Shipment and Get Non-Contract Shipment Details (docs print POST).
2. Constructed (non-link) URL for the NC and contract refund endpoints.
3. Constructed Get Service URL form.
4. `groupid` vs `groupId` query casing for Get Shipments.
5. Throttle rejection HTTP status.
6. Request-id response header name.
7. Artifact response `Content-Type`.
8. Tracking errors using the `messages` envelope.
9. Which statuses a gateway returns for a half-completed POST (the SDK treats 502/503/504 on a
   charging POST as indeterminate, see ADR 0001).
