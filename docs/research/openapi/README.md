# Canada Post OpenAPI documents

Source of truth for the wire shapes of the REST/JSON APIs of the new Canada Post Developer
Portal (OAuth2). They are vendor documents, kept verbatim; do not reformat them by hand.

| File                   | API                  | Version | Server                                                                                     |
| ---------------------- | -------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `shipping-v1.json`     | Shipping             | 1.0.0   | `https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/shipping/v1` |
| `rating-v1.json`       | Rating               | 3.0.0   | `https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs/rating/v1`   |
| `tracking-v1.json`     | Tracking             | 1.0.0   | `.../tracking/v1`                                                                          |
| `customerinfo-v1.json` | Customer Information | 1.0.0   | `.../customerinfo/v1`                                                                      |
| `returns-v1.json`      | Returns              | 1.0.0   | `.../returns/v1`                                                                           |
| `pickup-v1.json`       | Pickup               | 1.0.0   | `.../pickup/v1`                                                                            |
| `postoffice-v1.json`   | Post Office          | 1.0.0   | `.../postoffice/v1`                                                                        |
| `serviceinfo-v1.json`  | Service Information  | 1.0.0   | `.../serviceinfo/v1`                                                                       |

- Exported from the Canada Post Developer Portal API documentation on **2026-11-15**
  (`shipping`, `rating`) and **2026-11-16** (the other six).
- The six documents added on 2026-11-16 were downloaded files, so they were treated as untrusted
  input: parsed as JSON only, and sanitized before being committed. Within example values, phone
  numbers became `555-555-0100`, e-mail addresses `user@example.com`, Canada Post's sample customer
  numbers obvious fakes (`0000000001`, `0000001`, ...) and the base64 PDF of the certificate example a
  tiny placeholder. The sanitizer also refuses to write a document that contains any of this
  project's own credential values or a key-shaped string. `postoffice-v1.json` is otherwise
  verbatim, including its double-escaped `pattern`s (a vendor bug, see the contracts document).
- They contain only the public example data of Canada Post's own documentation. One value was
  changed after export: the `X-CPC-Zonos-Key` example in `shipping-v1.json`, a key-shaped string
  that looks like a live credential, now reads `credential_live_EXAMPLE-0000-…` so that
  `npm run check:secrets` (which flags credential-shaped values) stays meaningful.
- How they are used:
  - `packages/canada-post/test/support/openapi.ts` is a small strict validator for them (it
    throws on any keyword it does not implement, so an updated document can never turn the
    contract tests into a no-op).
  - `packages/canada-post/test/rest-contract.test.ts` checks every request the REST client
    builds and every typed fixture against these schemas, and that each SDK operation maps to
    a documented endpoint.
  - The live Test-app suite (`test/live-test-app/`) validates every live response against them.
- The contracts document (`../canadapost-api-contracts.md`, section 10) records where the
  Test app deviates from these documents and what is still an **ASSUMPTION**.

When Canada Post publishes a new version, replace the file, re-run `npm test` and
`npm run test:live:test-app`, and update section 10 of the contracts document.
