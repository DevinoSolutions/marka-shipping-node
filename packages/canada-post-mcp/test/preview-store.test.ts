import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  InMemoryPreviewStore,
  macMatches,
  sealPreview,
  type MacContext,
} from "../src/preview-store.js";

const ctx: MacContext = { key: "k".repeat(32), app: "test", customerNumber: "1234567" };
const NOW = 1_800_000_000_000;
const seal = (request: unknown = { a: 1 }, ttlSeconds = 300) =>
  sealPreview(ctx, { kind: "shipment.void", request, now: NOW, ttlSeconds });

describe("canonical JSON", () => {
  it("sorts keys and drops undefined, so property order cannot change the MAC", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: undefined }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":1}]},"b":1}',
    );
  });
});

describe("sealed previews", () => {
  it("get a 256-bit random base64url token each time", () => {
    const a = seal();
    const b = seal();
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.id).not.toBe(b.id);
  });

  it("verify under the same key, app and customer and fail under any change", () => {
    const record = seal({ shipmentId: "1" });
    expect(macMatches(ctx, record)).toBe(true);
    expect(macMatches({ ...ctx, key: "z".repeat(32) }, record)).toBe(false);
    expect(macMatches({ ...ctx, app: "production" }, record)).toBe(false);
    expect(macMatches({ ...ctx, customerNumber: "7654321" }, record)).toBe(false);
    expect(macMatches(ctx, { ...record, request: { shipmentId: "2" } })).toBe(false);
    expect(macMatches(ctx, { ...record, kind: "shipment.create" })).toBe(false);
    expect(macMatches(ctx, { ...record, expiresAt: record.expiresAt + 1 })).toBe(false);
    expect(macMatches(ctx, { ...record, id: "x".repeat(43) })).toBe(false);
    expect(macMatches(ctx, { ...record, mac: "00" })).toBe(false);
  });

  it("survive key reordering of the stored request", () => {
    const record = seal({ a: 1, b: { c: 2, d: 3 } });
    expect(macMatches(ctx, { ...record, request: { b: { d: 3, c: 2 }, a: 1 } })).toBe(true);
  });
});

describe("in-memory store", () => {
  it("hands a record out once", () => {
    const store = new InMemoryPreviewStore();
    const record = seal();
    store.put(record);
    expect(store.size()).toBe(1);
    expect(store.consume(record.id, NOW + 1)).toEqual({ status: "ok", record });
    expect(store.size()).toBe(0);
    expect(store.consume(record.id, NOW + 2)).toEqual({ status: "already_used" });
    expect(store.consume("never-seen", NOW)).toEqual({ status: "not_found" });
  });

  it("expires previews, and an expired one is removed on the attempt", () => {
    const store = new InMemoryPreviewStore();
    const record = seal({}, 60);
    store.put(record);
    expect(store.consume(record.id, record.expiresAt).status).toBe("expired");
    expect(store.size()).toBe(0);
    expect(store.consume(record.id, record.expiresAt).status).toBe("not_found");
  });

  it("evicts expired previews before counting the limit and refuses past 100", () => {
    const store = new InMemoryPreviewStore();
    for (let i = 0; i < 100; i += 1) store.put(seal({ i }, 60));
    expect(() => {
      store.put(seal({ i: 100 }, 60));
    }).toThrow(/too many pending previews/);
    const later = sealPreview(ctx, {
      kind: "shipment.void",
      request: {},
      now: NOW + 61_000,
      ttlSeconds: 60,
    });
    store.put(later);
    expect(store.size()).toBe(1);
  });

  it("remembers a bounded number of consumed ids", () => {
    const store = new InMemoryPreviewStore();
    const first = seal({ n: 0 });
    store.put(first);
    store.consume(first.id, NOW);
    for (let i = 1; i <= 1001; i += 1) {
      const record = seal({ n: i });
      store.put(record);
      store.consume(record.id, NOW);
    }
    // The oldest consumed id fell out of memory: it reads as unknown, never as valid.
    expect(store.consume(first.id, NOW).status).toBe("not_found");
  });
});
