import { CanadaPostApiError, CanadaPostParseError, CanadaPostValidationError } from "../errors.js";
import { queryString } from "../http.js";
import { fetchArtifact } from "./artifact.js";
import {
  accountUrl,
  jsonArray,
  jsonObject,
  jsonObjectOrSingleton,
  resolveRestTarget,
  type RestContext,
  type RestTarget,
} from "./context.js";
import { asRestLinks, requireRestLink } from "./links.js";
import { safeUrl } from "./redact.js";
import { parseJsonBody } from "./transport.js";
import type {
  RestArtifact,
  RestCreateShipmentRequest,
  RestCreateShipmentResponse,
  RestLink,
  RestPublicKeyInfo,
  RestRefundInfo,
  RestRefundRequest,
  RestShipmentDetails,
  RestShipmentGroup,
  RestShipmentInfo,
  RestShipmentPrice,
  RestShipmentReceipt,
  RestTransmitRequest,
} from "./types.js";

/** Options of {@link RestShipmentsApi.create}. */
export interface RestCreateShipmentOptions {
  /** `X-CPC-Zonos-Key` for this call (overrides the client default). */
  zonosKey?: string;
}

/**
 * Filters of {@link RestShipmentsApi.list}. At least one of `requestId`, `trackingPin`,
 * `groupId`, `manifestId` or `noManifest` is required: `date` and `limit` only narrow
 * another filter (a Production app rejects `date` alone with HTTP 400, errorCode 9156).
 */
export interface RestShipmentListInput {
  /** The `customerRequestId` you sent on create (max 32 characters). */
  requestId?: string;
  trackingPin?: string;
  groupId?: string;
  manifestId?: string;
  /** Only shipments that are not on a manifest yet. */
  noManifest?: boolean;
  /** `YYYYMMDD` or `YYYY-MM-DD`. Only narrows another filter; never sufficient alone. */
  date?: string;
  /** 1-99999. Only narrows another filter; never sufficient alone. */
  limit?: number;
}

/** Where a label can be found: a shipment id, a shipment response, or the label link itself. */
export type RestLabelSource = string | RestLink | { links: readonly RestLink[] };

const CREATE_RECOVERY =
  "Look the shipment up before retrying: shipments.list({ requestId }) with the " +
  "customerRequestId you sent, or shipments.get(id). A second create is a second, billed label.";
const REFUND_RECOVERY =
  "A refund request opens a service ticket and is not idempotent: do not send it again before " +
  "checking with Canada Post (or the refund confirmation e-mail) that no ticket exists.";
const TRANSMIT_RECOVERY =
  "Check manifests.list({ from, to }) and shipments.list({ groupId }) before retrying: a second " +
  "transmit can create a second manifest and bill the shipments again.";
/** The e-mail pattern of the Shipping OpenAPI document. */
const EMAIL =
  /^(['_A-Za-z0-9\-+]+)(\.['_A-Za-z0-9\-+]+)*@([A-Za-z0-9-]+)(\.[A-Za-z0-9-]+)*(\.[A-Za-z]{2,})$/;
const VOID_RECOVERY =
  "Check shipments.get(id).shipmentStatus before retrying: it says whether the void took effect.";

/** `…/shipping/v1/{mailedBy}/{mobo}` of the configured account. */
function accountPrefix(ctx: RestContext): string {
  return accountUrl(ctx, "shipping");
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
    const searchFilters = {
      "request-id": input.requestId,
      "tracking-pin": input.trackingPin,
      "group-id": input.groupId,
      "manifest-id": input.manifestId,
      "no-manifest": input.noManifest,
    };
    if (queryString(searchFilters) === "") {
      throw new CanadaPostValidationError(
        "shipments.list needs at least one of requestId, trackingPin, groupId, manifestId or " +
          "noManifest (date and limit only narrow another filter)",
      );
    }
    const query = queryString({
      ...searchFilters,
      date: input.date?.replaceAll("-", ""),
      limit: input.limit,
    });
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
    return asRestLinks(jsonArray(result, "shipments.list"), "shipments.list");
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

  /** The payment receipt of a shipment: card or contract-account details and the charge. */
  async getReceipt(target: RestTarget): Promise<RestShipmentReceipt> {
    const result = await this.ctx.http.execute({
      operation: "shipments.getReceipt",
      method: "GET",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}/receipt`,
      ),
      accept: "application/json",
    });
    return jsonObjectOrSingleton(result, "shipments.getReceipt") as unknown as RestShipmentReceipt;
  }

  /**
   * The public label URL and QR code of a shipment created with `createPublicKey` /
   * `createQrCode`.
   */
  async getQrCode(target: RestTarget): Promise<RestPublicKeyInfo> {
    const result = await this.ctx.http.execute({
      operation: "shipments.getQrCode",
      method: "GET",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}/qr-code`,
      ),
      accept: "application/json",
    });
    return jsonObjectOrSingleton(result, "shipments.getQrCode") as unknown as RestPublicKeyInfo;
  }

  /**
   * The shipment groups of the account (a group is what a manifest transmits). A Production
   * app answers HTTP 200 with the body `null` when the account has no groups; that is
   * returned as `[]`.
   */
  async getGroups(): Promise<RestShipmentGroup[]> {
    const result = await this.ctx.http.execute({
      operation: "shipments.getGroups",
      method: "GET",
      url: `${accountPrefix(this.ctx)}/groups`,
      accept: "application/json",
    });
    if (parseJsonBody(result, "shipments.getGroups") === null) return [];
    return jsonArray(result, "shipments.getGroups") as RestShipmentGroup[];
  }

  /**
   * Requests a refund for a shipment and returns the service ticket Canada Post opened. A
   * state change (a refund ticket), so it is never retried or replayed; an ambiguous failure is
   * {@link CanadaPostIndeterminateError}.
   */
  async requestRefund(target: RestTarget, request: RestRefundRequest): Promise<RestRefundInfo> {
    if (request.email.length > 60 || !EMAIL.test(request.email)) {
      throw new CanadaPostValidationError("email must be a valid address of at most 60 characters");
    }
    const result = await this.ctx.http.execute({
      operation: "shipments.requestRefund",
      method: "POST",
      url: resolveRestTarget(
        target,
        "shipment id",
        (id) => `${accountPrefix(this.ctx)}/shipments/${id}/refund`,
      ),
      accept: "application/json",
      body: { email: request.email },
      mutating: true,
      recovery: REFUND_RECOVERY,
    });
    return jsonObjectOrSingleton(result, "shipments.requestRefund") as unknown as RestRefundInfo;
  }

  /**
   * Transmits the shipments of one or more groups (creates a manifest). **Bills the shipments
   * in a Production app.** Never retried; an ambiguous failure is
   * {@link CanadaPostIndeterminateError}. Returns links to the manifests it created.
   */
  async transmit(request: RestTransmitRequest): Promise<RestLink[]> {
    if (request.groupIds.length === 0 || request.groupIds.some((g) => g === "" || g.length > 32)) {
      throw new CanadaPostValidationError(
        "groupIds needs at least one group id of 1-32 characters",
      );
    }
    if (request.excludedShipments?.length === 0) {
      throw new CanadaPostValidationError(
        "excludedShipments must be omitted or hold a shipment id",
      );
    }
    const id = request.customerRequestId;
    if (id !== undefined && (id === "" || id.length > 35)) {
      throw new CanadaPostValidationError("customerRequestId must be 1-35 characters");
    }
    const result = await this.ctx.http.execute({
      operation: "shipments.transmit",
      method: "POST",
      url: `${accountPrefix(this.ctx)}/manifests`,
      accept: "application/json",
      body: request,
      mutating: true,
      recovery: TRANSMIT_RECOVERY,
    });
    return asRestLinks(jsonArray(result, "shipments.transmit"), "shipments.transmit");
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
