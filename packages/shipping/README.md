# @joinmarka/shipping

**Marka Shipping**: the shipping SDKs from [Marka](https://joinmarka.com) in one package.

| Carrier     | Standalone package                                                               | Here                                       |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| Canada Post | [`@joinmarka/canada-post`](https://www.npmjs.com/package/@joinmarka/canada-post) | `canadaPost` namespace (and the top level) |

Need only one carrier? Install its standalone package. It is the same code.

```bash
npm install @joinmarka/shipping
```

```ts
import { canadaPost } from "@joinmarka/shipping";

const client = canadaPost.createCanadaPostClient({
  username: process.env.CANADAPOST_USERNAME!,
  password: process.env.CANADAPOST_PASSWORD!,
  customerNumber: process.env.CANADAPOST_CUSTOMER_NUMBER!,
  // environment defaults to "development" (the sandbox); production labels cost money
});

const quotes = await client.rating.getRates({
  originPostalCode: "K1A0B1",
  destination: { type: "domestic", postalCode: "M5V2T6" },
  parcel: { weightKg: 1 },
});
```

The full Canada Post guide (shipments, PDF/ZPL labels, manifests, tracking, error handling) is in the [`@joinmarka/canada-post` README](https://github.com/DevinoSolutions/marka-shipping-node/tree/main/packages/canada-post#readme).

Test helpers: `import { createMockFetch } from "@joinmarka/shipping/testing"`.

> Unofficial and community-maintained. Not affiliated with Canada Post or any carrier. Carrier names and marks belong to their owners.

MIT licensed.
