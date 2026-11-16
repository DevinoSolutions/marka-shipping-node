import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The write operations that go through preview then apply. */
export type OperationKind =
  | "shipment.create"
  | "shipment.void"
  | "shipment.refund"
  | "manifest.transmit"
  | "pickup.create"
  | "pickup.cancel"
  | "return.create";

/** A previewed operation, exactly as it will be executed. */
export interface PreviewRecord {
  /** The confirm token: 256 random bits, base64url. Single use. */
  readonly id: string;
  readonly kind: OperationKind;
  /** The normalized request. Apply sends exactly this and nothing the caller can change. */
  readonly request: unknown;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
  /** HMAC-SHA256 over the canonical form of the fields above (and the app and customer). */
  readonly mac: string;
}

export type ConsumeResult =
  | { readonly status: "ok"; readonly record: PreviewRecord }
  | { readonly status: "not_found" | "expired" | "already_used" };

/** Where previews live. The in-memory implementation is the only one shipped (stdio, one process). */
export interface PreviewStore {
  put(record: PreviewRecord): void;
  /** Atomically removes and returns the record (single use). */
  consume(id: string, now: number): ConsumeResult;
  /** Number of previews waiting to be applied. */
  size(): number;
}

const MAX_PENDING = 100;
const MAX_CONSUMED_MEMORY = 1000;

/** Key-sorted JSON, so the MAC does not depend on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The values the MAC binds besides the record itself. */
export interface MacContext {
  readonly key: string;
  readonly app: string;
  readonly customerNumber: string;
}

function macOf(ctx: MacContext, record: Omit<PreviewRecord, "mac">): string {
  return createHmac("sha256", ctx.key)
    .update(
      canonicalJson({
        id: record.id,
        kind: record.kind,
        request: record.request,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        app: ctx.app,
        customerNumber: ctx.customerNumber,
      }),
    )
    .digest("hex");
}

/** Builds a sealed record with a fresh random token. */
export function sealPreview(
  ctx: MacContext,
  fields: { kind: OperationKind; request: unknown; now: number; ttlSeconds: number },
): PreviewRecord {
  const base = {
    id: randomBytes(32).toString("base64url"),
    kind: fields.kind,
    request: fields.request,
    createdAt: fields.now,
    expiresAt: fields.now + fields.ttlSeconds * 1000,
  };
  return { ...base, mac: macOf(ctx, base) };
}

/** Whether the stored MAC still matches (constant-time). A tampered record must not be applied. */
export function macMatches(ctx: MacContext, record: PreviewRecord): boolean {
  const { mac, ...rest } = record;
  const expected = Buffer.from(macOf(ctx, rest), "hex");
  const actual = Buffer.from(mac, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** In-process store: previews are lost on restart, which is the safe direction. */
export class InMemoryPreviewStore implements PreviewStore {
  private readonly pending = new Map<string, PreviewRecord>();
  private readonly consumed = new Set<string>();

  put(record: PreviewRecord): void {
    this.evictExpired(record.createdAt);
    if (this.pending.size >= MAX_PENDING) {
      throw new Error(
        `too many pending previews (${String(MAX_PENDING)}); apply or let them expire first`,
      );
    }
    this.pending.set(record.id, record);
  }

  consume(id: string, now: number): ConsumeResult {
    const record = this.pending.get(id);
    if (record === undefined) {
      return { status: this.consumed.has(id) ? "already_used" : "not_found" };
    }
    // Single use even when expired: the entry is removed either way.
    this.pending.delete(id);
    if (now >= record.expiresAt) return { status: "expired" };
    this.consumed.add(id);
    if (this.consumed.size > MAX_CONSUMED_MEMORY) {
      const oldest = this.consumed.values().next().value;
      if (oldest !== undefined) this.consumed.delete(oldest);
    }
    return { status: "ok", record };
  }

  size(): number {
    return this.pending.size;
  }

  private evictExpired(now: number): void {
    for (const [id, record] of this.pending) {
      if (now >= record.expiresAt) this.pending.delete(id);
    }
  }
}
