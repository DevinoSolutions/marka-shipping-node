import {
  CanadaPostApiError,
  CanadaPostError,
  CanadaPostParseError,
  CanadaPostValidationError,
} from "../errors.js";
import { queryString } from "../http.js";
import { REST_BASE_URL } from "./config.js";
import {
  jsonArray,
  jsonObject,
  jsonObjectOrSingleton,
  resolveRestTarget,
  type RestContext,
  type RestTarget,
} from "./context.js";
import { assertTrustedRestHref, requireRestLink } from "./links.js";
import { safeUrl } from "./redact.js";
import { parseJsonBody } from "./transport.js";
import type {
  RestArtifact,
  RestCreateShipmentRequest,
  RestCreateShipmentResponse,
  RestLink,
  RestShipmentDetails,
  RestShipmentInfo,
  RestShipmentPrice,
} from "./types.js";

/** Options of {@link RestShipmentsApi.create}. */
export interface RestCreateShipmentOptions {
  /** `X-CPC-Zonos-Key` for this call (overrides the client default). */
  zonosKey?: string;
}

/** Filters of {@link RestShipmentsApi.list}. At least one is required. */
export interface RestShipmentListInput {
  /** The `customerRequestId` you sent on create (max 32 characters). */
  requestId?: string;
  trackingPin?: string;
  groupId?: string;
  manifestId?: string;
  /** Only shipments that are not on a manifest yet. */
  noManifest?: boolean;
  /** `YYYYMMDD` or `YYYY-MM-DD`. */
  date?: string;
  /** 1-99999. */
  limit?: number;
}

/** Where a label can be found: a shipment id, a shipment response, or the label link itself. */
export type RestLabelSource = string | RestLink | { links: readonly RestLink[] };

const CREATE_RECOVERY =
  "Look the shipment up before retrying: shipments.list({ requestId }) with the " +
  "customerRequestId you sent, or shipments.get(id). A second create is a second, billed label.";
const VOID_RECOVERY =
  "Check shipments.get(id).shipmentStatus before retrying: it says whether the void took effect.";

function isLink(value: unknown): value is RestLink {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { rel?: unknown }).rel === "string" &&
    typeof (value as { href?: unknown }).href === "string"
  );
}

function asLinks(value: unknown[], operation: string): RestLink[] {
  if (!value.every(isLink)) {
    throw new CanadaPostParseError(`${operation}: expected a list of links in the response`);
  }
  return value;
}

/** An HTML error page must never be returned as a label. */
function checkArtifact(contentType: string, data: Uint8Array, operation: string): void {
  if (data.byteLength === 0) {
    throw new CanadaPostParseError(`${operation}: the artifact response is empty`);
  }
  if (contentType === "application/pdf") {
    const magic = new TextDecoder("latin1").decode(data.subarray(0, 5));
    if (magic !== "%PDF-") {
      throw new CanadaPostParseError(`${operation}: the response is not a PDF document`);
    }
  }
}

/** Downloads a binary artifact (PDF or ZPL) through a link on the Canada Post host. */
export async function fetchArtifact(
  ctx: RestContext,
  link: RestLink,
  operation: string,
): Promise<RestArtifact> {
  const url = assertTrustedRestHref(link.href).toString();
  const accept = link.mediaType === "" ? "application/pdf" : link.mediaType;
  const result = await ctx.http.execute({ operation, method: "GET", url, accept });
  if (result.status !== 200) {
    throw new CanadaPostApiError({
      status: result.status,
      messages: [],
      request: { method: "GET", url: safeUrl(url), operation },
      requestId: result.requestId,
    });
  }
  const contentType = result.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf" && contentType !== "application/zpl") {
    throw new CanadaPostError(
      `${operation}: unexpected content type ${JSON.stringify((contentType ?? "none").slice(0, 60))} (expected application/pdf or application/zpl)`,
    );
  }
  checkArtifact(contentType, result.data, operation);
  return { contentType, data: result.data };
}

/** `…/shipping/v1/{mailedBy}/{mobo}` of the configured account. */
function accountPrefix(ctx: RestContext): string {
  return `${REST_BASE_URL}/shipping/v1/${ctx.config.customerNumber}/${ctx.config.mobo}`;
}

/**
 * Contract shipments over the REST API (Shipping v1). `create` charges real postage in a
 * Production app.
 */
export class RestShipmentsApi {
  constructor(private readonly ctx: RestContext) {}

  /**
   * Creates a shipment and its label. **Charges postage in a Production app.**
   *
   * Never retried. A timeout, dropped connection or 502/503/504 throws
   * {@link CanadaPostIndeterminateError}: the shipment may exist. Always send
   * `customerRequestId` so it can be found again with {@link RestShipmentsApi.list}.
   * Exactly one of `transmitShipment: true` or `groupId` is required.
   */
  async create(
    request: RestCreateShipmentRequest,
    options: RestCreateShipmentOptions = {},
  ): Promise<RestCreateShipmentResponse> {
    const { ctx } = this;
    const loose = request as { transmitShipment?: unknown; groupId?: unknown };
    const transmit = loose.transmitShipment === true;
    const grouped = typeof loose.groupId === "string" && loose.groupId !== "";
    if (transmit === grouped) {
      throw new CanadaPostValidationError(
        "Send exactly one of transmitShipment: true (no manifest) or groupId",
      );
    }
    const id = request.customerRequestId;
    if (id !== undefined && (id === "" || id.length > 35)) {
      throw new CanadaPostValidationError("customerRequestId must be 1-35 characters");
    }
    const zonosKey = options.zonosKey ?? ctx.config.zonosKey;
    const result = await ctx.http.execute({
      operation: "shipments.create",
      method: "POST",
      url: `${accountPrefix(this.ctx)}/shipments`,
      accept: "application/json",
      body: request,
      mutating: true,
      recovery: CREATE_RECOVERY,
      ...(zonosKey === undefined ? {} : { headers: { "X-CPC-Zonos-Key": zonosKey } }),
    });
    const body = parseJsonBody(result, "shipments.create", true) as Partial<
      Record<keyof RestCreateShipmentResponse, unknown>
    > | null;
    if (
      typeof body !== "object" ||
      body === null ||
      typeof body.shipmentId !== "string" ||
      !Array.isArray(body.links)
    ) {
      throw new CanadaPostParseError(
        "shipments.create: HTTP 2xx but the response has no shipmentId and links. The request " +
          "WAS accepted: look the shipment up (customerRequestId) before retrying.",
      );
    }
    return body as unknown as RestCreateShipmentResponse;
  }

  /** Status, tracking PIN and links of a shipment. */
  async get(target: RestTarget): Promise<RestShipmentInfo> {
    const result = await this.ctx.http.execute({
      operation: "shipments.get",
      method: "GET",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}`,
      ),
      accept: "application/json",
    });
    return jsonObject(result, "shipments.get") as unknown as RestShipmentInfo;
  }

  /** The delivery spec and state of a shipment (`rel="details"`). */
  async getDetails(target: RestTarget): Promise<RestShipmentDetails> {
    const result = await this.ctx.http.execute({
      operation: "shipments.getDetails",
      method: "GET",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}/details`,
      ),
      accept: "application/json",
    });
    return jsonObjectOrSingleton(result, "shipments.getDetails") as RestShipmentDetails;
  }

  /** The price of a shipment (`rel="price"`). */
  async getPrice(target: RestTarget): Promise<RestShipmentPrice> {
    const result = await this.ctx.http.execute({
      operation: "shipments.getPrice",
      method: "GET",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}/price`,
      ),
      accept: "application/json",
    });
    return jsonObjectOrSingleton(result, "shipments.getPrice") as unknown as RestShipmentPrice;
  }

  /**
   * Links of the shipments matching a filter (for example the `customerRequestId` of an
   * indeterminate create). HTTP 202 (still being created) is thrown as
   * {@link CanadaPostApiError} with `isPending === true`.
   */
  async list(input: RestShipmentListInput): Promise<RestLink[]> {
    const query = queryString({
      "request-id": input.requestId,
      "tracking-pin": input.trackingPin,
      "group-id": input.groupId,
      "manifest-id": input.manifestId,
      "no-manifest": input.noManifest,
      date: input.date?.replaceAll("-", ""),
      limit: input.limit,
    });
    if (query === "") {
      throw new CanadaPostValidationError("shipments.list needs at least one filter");
    }
    const url = `${accountPrefix(this.ctx)}/shipments${query}`;
    const result = await this.ctx.http.execute({
      operation: "shipments.list",
      method: "GET",
      url,
      accept: "application/json",
    });
    if (result.status === 202) {
      throw new CanadaPostApiError({
        status: 202,
        messages: [],
        request: { method: "GET", url: safeUrl(url), operation: "shipments.list" },
      });
    }
    return asLinks(jsonArray(result, "shipments.list"), "shipments.list");
  }

  /**
   * Voids a shipment that has not been transmitted. Never retried; an ambiguous failure is
   * {@link CanadaPostIndeterminateError} (check `get(id).shipmentStatus`).
   */
  async void(target: RestTarget): Promise<void> {
    await this.ctx.http.execute({
      operation: "shipments.void",
      method: "DELETE",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}`,
      ),
      accept: "application/json",
      mutating: true,
      recovery: VOID_RECOVERY,
    });
  }

  /**
   * Downloads the label. Pass a shipment id (one extra `get`), a `create`/`get` response, or
   * the `label` link. Returns the raw bytes: PDF, or ZPL when the shipment asked for it.
   */
  async getLabel(source: RestLabelSource): Promise<RestArtifact> {
    let link: RestLink;
    if (typeof source === "string") {
      link = requireRestLink((await this.get(source)).links, "label");
    } else if ("links" in source) {
      link = requireRestLink(source.links, "label");
    } else {
      link = source;
    }
    return fetchArtifact(this.ctx, link, "shipments.getLabel");
  }
}
