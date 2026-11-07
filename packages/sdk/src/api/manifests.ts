import { MEDIA_TYPES } from "../config.js";
import { queryString, rootElement } from "../http.js";
import { findLink, mapLinks, type CanadaPostLink } from "../links.js";
import { bool, child, num, parseXml, str } from "../xml/parse.js";
import {
  contractPrefix,
  formatCompactDate,
  resolveTarget,
  type ApiContext,
  type LinkOrId,
} from "./context.js";

/** Result of {@link ManifestsApi.get}. */
export interface Manifest {
  /** Purchase order number; `EMPTY` for the placeholder manifest of auto-billed shipments. */
  poNumber: string | undefined;
  customerRequestId: string | undefined;
  /** `self`, `artifact` (the printable manifest), `details`, `manifestShipments`. */
  links: CanadaPostLink[];
  /** Shortcut for `findLink(links, "artifact")`. */
  artifactLink: CanadaPostLink | undefined;
  /** Shortcut for `findLink(links, "manifestShipments")`. */
  shipmentsLink: CanadaPostLink | undefined;
  raw: unknown;
}

/** Input of {@link ManifestsApi.list}. */
export interface ManifestListInput {
  /** `Date` or `YYYYMMDD` / `YYYY-MM-DD`. */
  start: Date | string;
  /** Defaults to today. */
  end?: Date | string;
}

/** Result of {@link ManifestsApi.list}. */
export interface ManifestList {
  /** One `manifest` link per manifest. Pass them to `get`. */
  links: CanadaPostLink[];
  raw: unknown;
}

/** Result of {@link ManifestsApi.getDetails}. */
export interface ManifestDetails {
  poNumber: string | undefined;
  finalShippingPoint: string | undefined;
  shippingPointName: string | undefined;
  shippingPointId: string | undefined;
  cpcPickupIndicator: boolean | undefined;
  mailedByCustomer: string | undefined;
  mailedOnBehalfOf: string | undefined;
  paidByCustomer: string | undefined;
  customerRef: string | undefined;
  manifestDate: string | undefined;
  manifestTime: string | undefined;
  contractId: string | undefined;
  methodOfPayment: string | undefined;
  pricing: {
    baseCost: number | undefined;
    automationDiscount: number | undefined;
    optionsAndSurcharges: number | undefined;
    gst: number | undefined;
    pst: number | undefined;
    hst: number | undefined;
    totalDueCpc: number | undefined;
  };
  raw: unknown;
}

/** Manifests created by `shipments.transmit`. */
export class ManifestsApi {
  constructor(private readonly ctx: ApiContext) {}

  #base(): string {
    return `${contractPrefix(this.ctx)}/manifest`;
  }

  /**
   * Reads one manifest (a `manifest` link from `shipments.transmit` / `list`, or its id). A
   * successful response confirms the manifest exists. HTTP 202 (code `9153`) means the
   * transmit is still running: thrown as `CanadaPostApiError` with `isPending === true`.
   * HTTP 412 (code `9154`) means the transmit failed.
   */
  async get(manifest: LinkOrId): Promise<Manifest> {
    const { ctx } = this;
    const target = resolveTarget(ctx, manifest, "manifest id", (id) => `${this.#base()}/${id}`);
    const res = await ctx.http.execute({
      operation: "manifests.get",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.manifest,
    });
    const root = rootElement(parseXml(res.text), "manifest", "manifests.get");
    const links = mapLinks(child(root, "links"));
    return {
      poNumber: str(root, "po-number"),
      customerRequestId: str(root, "customer-request-id"),
      links,
      artifactLink: findLink(links, "artifact"),
      shipmentsLink: findLink(links, "manifestShipments"),
      raw: root,
    };
  }

  /** Lists manifests created in a date range. An empty range returns no links. */
  async list(input: ManifestListInput): Promise<ManifestList> {
    const { ctx } = this;
    const url =
      `${ctx.config.baseUrl}${this.#base()}` +
      queryString({
        start: formatCompactDate(input.start, "start"),
        end: input.end === undefined ? undefined : formatCompactDate(input.end, "end"),
      });
    const res = await ctx.http.execute({
      operation: "manifests.list",
      method: "GET",
      url,
      accept: MEDIA_TYPES.manifest,
    });
    const root = rootElement(parseXml(res.text), "manifests", "manifests.list");
    return { links: mapLinks(root), raw: root };
  }

  /** Reads the totals and payment details of a manifest (`details` link or manifest id). */
  async getDetails(manifest: LinkOrId): Promise<ManifestDetails> {
    const { ctx } = this;
    const target = resolveTarget(
      ctx,
      manifest,
      "manifest id",
      (id) => `${this.#base()}/${id}/details`,
    );
    const res = await ctx.http.execute({
      operation: "manifests.getDetails",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.manifest,
    });
    const d = rootElement(parseXml(res.text), "manifest-details", "manifests.getDetails");
    const p = child(d, "manifest-pricing-info");
    return {
      poNumber: str(d, "po-number"),
      finalShippingPoint: str(d, "final-shipping-point"),
      shippingPointName: str(d, "shipping-point-name"),
      shippingPointId: str(d, "shipping-point-id"),
      cpcPickupIndicator: bool(d, "cpc-pickup-indicator"),
      mailedByCustomer: str(d, "mailed-by-customer"),
      mailedOnBehalfOf: str(d, "mailed-on-behalf-of"),
      paidByCustomer: str(d, "paid-by-customer"),
      customerRef: str(d, "customer-ref"),
      manifestDate: str(d, "manifest-date"),
      manifestTime: str(d, "manifest-time"),
      contractId: str(d, "contract-id"),
      methodOfPayment: str(d, "method-of-payment"),
      pricing: {
        baseCost: num(p, "base-cost"),
        automationDiscount: num(p, "automation-discount"),
        optionsAndSurcharges: num(p, "options-and-surcharges"),
        gst: num(p, "gst"),
        pst: num(p, "pst"),
        hst: num(p, "hst"),
        totalDueCpc: num(p, "total-due-cpc"),
      },
      raw: d,
    };
  }
}
