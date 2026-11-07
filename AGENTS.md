# AGENTS.md

Full agent instructions live in **[CLAUDE.md](./CLAUDE.md)** — read it before changing code.

Non-negotiables (duplicated here so no tool misses them):

1. Never create, void, transmit or refund anything against **production** without the owner
   explicitly authorizing that specific action in the current session. Production shipment
   creation charges real postage.
2. `packages/canada-post/test/live/` is READ-ONLY and SANDBOX-ONLY — never add writes or a production
   environment there. `npm run check:live-readonly` enforces this and derives its forbidden
   list from `packages/canada-post/src/operations.ts`; extend the table, never weaken the guard.
3. Secrets stay in `.env`. Never print, log, commit or hardcode credentials or values derived
   from them (including `base64(username:password)`). `npm run check:secrets` scans the working
   tree and must stay that way.
4. The default environment is the sandbox; production is always an explicit caller choice.
5. Writes are never auto-retried. A write that times out is indeterminate (ADR 0001).
6. Classify operations by `src/operations.ts`, not by HTTP verb.
7. `docs/research/canadapost-api-contracts.md` is binding; mark unverified shapes **ASSUMPTION**.

Before claiming done: `npm run build && npm run typecheck && npm run lint &&
npm run format:check && npm test && npm run verify:exports && npm run check:secrets &&
npm run check:live-readonly && npm run check:deadcode && npm run docs:api &&
npm run pack:dry` — all exit 0.

Never add AI/assistant attribution anywhere (commits, code, docs).
