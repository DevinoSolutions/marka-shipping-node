# Contributing

Thanks for helping. This is a community SDK; it is not affiliated with Canada Post.

## Setup

```bash
git clone https://github.com/DevinoSolutions/marka-shipping-node.git
cd marka-shipping-node
npm install            # Node >= 22.12
npm run build && npm test
```

## Before you open a pull request

All of these must exit 0:

```bash
npm run build && npm run typecheck && npm run lint && npm run format:check && npm test \
  && npm run verify:exports && npm run check:secrets && npm run check:live-readonly \
  && npm run check:deadcode && npm run docs:api && npm run pack:dry
```

Use conventional commit messages (`feat(sdk): ...`, `fix(sdk): ...`, `docs: ...`).

## Rules that protect real money and real accounts

- **Never** run `create`, `void`, `transmit` or refund calls against production, and never add
  them to `packages/sdk/test/live/`. The live suite is read-only and sandbox-only
  (`npm run check:live-readonly`). New mutating operations go into
  `packages/sdk/src/operations.ts` with `access: "write"`, which extends the guard.
- Never commit credentials, customer numbers, contract ids, PINs or real addresses. Fixtures use
  fake values transcribed from the official examples. Secrets belong in a local `.env`
  (copy `.env.example`); `npm run check:secrets` scans the working tree.
- Writes are never auto-retried (see `docs/adr/0001-indeterminate-writes.md`).

## Adding or changing an endpoint

1. Read the official page (see the links in the README) and extend
   `docs/research/canadapost-api-contracts.md` first: method, path, media type and version,
   request and response XML, error codes, the page URL and the date you read it. Mark anything
   you could not verify **ASSUMPTION**.
2. Implement it under `packages/sdk/src/api/`, mapping XML to camelCase types and keeping the
   parsed XML on `raw`. Build request XML with `leaf`/`wrap` (escaped), parse with the helpers
   in `src/xml/parse.ts` (every list can be one object or an array).
3. Register the operation in `src/operations.ts`.
4. Add mocked tests with fixtures transcribed from the official example.

## Reporting security issues

See [SECURITY.md](SECURITY.md).
