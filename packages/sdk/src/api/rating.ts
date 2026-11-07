import { MEDIA_TYPES, NAMESPACES } from "../config.js";
import { CanadaPostValidationError } from "../errors.js";
import { queryString, rootElement } from "../http.js";
import { mapLink, mapLinks, type CanadaPostLink } from "../links.js";
import { decimal, document, leaf, wrap } from "../xml/build.js";
import {
  asArray,
  attr,
  bool,
  child,
  children,
  num,
  parseXml,
  str,
  textOf,
  toNumber,
  type XmlNode,
} from "../xml/parse.js";
import { normalizePostalCode, resolveTarget, type ApiContext, type LinkOrId } from "./context.js";
import type { DimensionsInput, ShipmentOptionInput } from "./shipping-common.js";
import { buildDimensions, buildWeight, requireRecord, requireText } from "./shipping-common.js";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** Where the parcel is going. Exactly one shape. */
export type RatingDestination =
  | { type: "domestic"; postalCode: string }
  | { type: "united-states"; zipCode: string }
  | { type: "international"; countryCode: string; postalCode?: string };

/** Input of {@link RatingApi.getRates}. */
export interface GetRatesInput {
  originPostalCode: string;
  destination: RatingDestination;
  parcel: {
    weightKg: number;
    dimensionsCm?: DimensionsInput;
    unpackaged?: boolean;
    mailingTube?: boolean;
    oversized?: boolean;
  };
  /** Services to rate (max 20). Omit to rate every applicable service. */
  serviceCodes?: readonly string[];
  /** Options to include in the price (max 20). */
  options?: readonly Pick<ShipmentOptionInput, "code" | "amount">[];
  /**
   * `"commercial"` (default) sends your customer number (and contract id, if configured) for
   * discounted rates. `"counter"` omits both and asks for the regular consumer price.
   */
  quoteType?: "commercial" | "counter";
  promoCode?: string;
  /** `YYYY-MM-DD`; only affects the expected delivery date. */
  expectedMailingDate?: string;
  /** Override the configured contract id for this quote. */
  contractId?: string;
}

/** Tax amounts of a quote. */
export interface QuoteTaxes {
  gst: number | undefined;
  pst: number | undefined;
  hst: number | undefined;
}

/** Quote-level option line. */
export interface QuoteOption {
  code: string | undefined;
  name: string | undefined;
  price: number | undefined;
  /** True if the option is included at no charge. */
  included: boolean | undefined;
}

/** Quote-level adjustment (discounts and surcharges). */
export interface QuoteAdjustment {
  code: string | undefined;
  name: string | undefined;
  cost: number | undefined;
  percent: number | undefined;
}

/** One service price quote. */
export interface PriceQuote {
  serviceCode: string;
  serviceName: string | undefined;
  /** Link to {@link RatingApi.getService} for this service. */
  serviceLink: CanadaPostLink | undefined;
  priceDetails: {
    base: number | undefined;
    taxes: QuoteTaxes;
    /** Total payable in CAD including taxes, options and adjustments. */
    due: number | undefined;
    options: QuoteOption[];
    adjustments: QuoteAdjustment[];
  };
  cubedWeight: number | undefined;
  serviceStandard: {
    amDelivery: boolean | undefined;
    guaranteedDelivery: boolean | undefined;
    expectedTransitTimeDays: number | undefined;
    expectedDeliveryDate: string | undefined;
  };
}

/** Result of {@link RatingApi.getRates}. */
export interface GetRatesResult {
  quotes: PriceQuote[];
  /** Parsed `price-quotes` element, for fields that are not mapped. */
  raw: unknown;
}

/** Entry of {@link DiscoverServicesResult}. */
export interface ServiceSummary {
  serviceCode: string;
  serviceName: string | undefined;
  /** Link to {@link RatingApi.getService}. */
  link: CanadaPostLink | undefined;
}

/** Input of {@link RatingApi.discoverServices}. */
export interface DiscoverServicesInput {
  /** Destination country (ISO 3166-1 alpha-2). */
  country?: string;
  /** Also list services restricted to this contract. Defaults to the configured contract id. */
  contractId?: string;
  originPostalCode?: string;
  /** Requires `originPostalCode`. */
  destinationPostalCode?: string;
}

/** Result of {@link RatingApi.discoverServices}. */
export interface DiscoverServicesResult {
  services: ServiceSummary[];
  raw: unknown;
}

/** Option listed by Get Service. */
export interface ServiceOption {
  code: string | undefined;
  name: string | undefined;
  /** Link to {@link RatingApi.getOption}. */
  link: CanadaPostLink | undefined;
  mandatory: boolean | undefined;
  qualifierRequired: boolean | undefined;
  qualifierMax: number | undefined;
}

/** Min/max of a dimension in centimetres. */
export interface DimensionRange {
  min: number | undefined;
  max: number | undefined;
}

/** Result of {@link RatingApi.getService}. */
export interface ServiceDetails {
  serviceCode: string | undefined;
  serviceName: string | undefined;
  comment: string | undefined;
  options: ServiceOption[];
  restrictions: {
    /** Grams, as published by Canada Post. */
    weightGrams: DimensionRange;
    length: DimensionRange;
    width: DimensionRange;
    height: DimensionRange;
    lengthPlusGirthMax: number | undefined;
    lengthHeightWidthSumMax: number | undefined;
    oversizeLimit: number | undefined;
    densityFactor: number | undefined;
    canShipInMailingTube: boolean | undefined;
    canShipUnpackaged: boolean | undefined;
    allowedAsReturnService: boolean | undefined;
  };
  raw: unknown;
}

/** Result of {@link RatingApi.getOption}. */
export interface OptionDetails {
  optionCode: string | undefined;
  optionName: string | undefined;
  /** `FEAT` service feature, `DI` delivery instruction, `NDI` non-delivery instruction. */
  optionClass: string | undefined;
  printsOnLabel: boolean | undefined;
  qualifierRequired: boolean | undefined;
  conflictingOptions: string[];
  prerequisiteOptions: string[];
  raw: unknown;
}

// ---------------------------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------------------------

function buildDestination(input: unknown): string {
  const d = requireRecord<Record<string, unknown>>(input, "destination");
  switch (d["type"]) {
    case "domestic":
      return wrap(
        "destination",
        wrap(
          "domestic",
          leaf(
            "postal-code",
            normalizePostalCode(requireText(d["postalCode"], "destination.postalCode")),
          ),
        ),
      );
    case "united-states":
      return wrap(
        "destination",
        wrap(
          "united-states",
          leaf("zip-code", requireText(d["zipCode"], "destination.zipCode").trim()),
        ),
      );
    case "international":
      return wrap(
        "destination",
        wrap(
          "international",
          leaf(
            "country-code",
            requireText(d["countryCode"], "destination.countryCode").toUpperCase(),
          ),
          leaf(
            "postal-code",
            typeof d["postalCode"] === "string" ? d["postalCode"].trim() : undefined,
          ),
        ),
      );
    default:
      throw new CanadaPostValidationError(
        `destination.type must be "domestic", "united-states" or "international" (got ${JSON.stringify(d["type"])}); ` +
          'for example { type: "domestic", postalCode: "K1A0B1" }',
      );
  }
}

/** Builds the `mailing-scenario` request body. */
function buildMailingScenario(
  input: GetRatesInput,
  defaults: { customerNumber: string; contractId: string | undefined },
): string {
  requireRecord(input, "getRates input");
  requireText(input.originPostalCode, "originPostalCode");
  const parcel = requireRecord<Record<string, unknown>>(input.parcel, "parcel");
  if (typeof parcel["weightKg"] !== "number") {
    throw new CanadaPostValidationError("parcel.weightKg is required (a number, in kg)");
  }
  const counter = input.quoteType === "counter";
  const services = input.serviceCodes ?? [];
  const options = input.options ?? [];
  if (services.length > 20) {
    throw new CanadaPostValidationError("serviceCodes may contain at most 20 services");
  }
  if (options.length > 20) {
    throw new CanadaPostValidationError("options may contain at most 20 entries");
  }
  const contractId = counter ? undefined : (input.contractId ?? defaults.contractId);
  return document(
    "mailing-scenario",
    NAMESPACES.rating,
    counter ? "" : leaf("customer-number", defaults.customerNumber),
    leaf("contract-id", contractId),
    leaf("promo-code", input.promoCode),
    leaf("quote-type", input.quoteType),
    leaf("expected-mailing-date", input.expectedMailingDate),
    wrap(
      "options",
      ...options.map((o) =>
        wrap(
          "option",
          leaf("option-code", o.code),
          o.amount === undefined ? "" : leaf("option-amount", decimal(o.amount, 2)),
        ),
      ),
    ),
    wrap(
      "parcel-characteristics",
      buildWeight(input.parcel.weightKg),
      buildDimensions(input.parcel.dimensionsCm),
      leaf("unpackaged", input.parcel.unpackaged),
      leaf("mailing-tube", input.parcel.mailingTube),
      leaf("oversized", input.parcel.oversized),
    ),
    wrap("services", ...services.map((s) => leaf("service-code", s))),
    leaf("origin-postal-code", normalizePostalCode(input.originPostalCode)),
    buildDestination(input.destination),
  );
}

function mapQuote(node: XmlNode): PriceQuote {
  const details = child(node, "price-details");
  const taxes = child(details, "taxes");
  const standard = child(node, "service-standard");
  return {
    serviceCode: str(node, "service-code") ?? "",
    serviceName: str(node, "service-name"),
    serviceLink: mapLink(child(node, "service-link") ?? {}),
    priceDetails: {
      base: num(details, "base"),
      taxes: { gst: num(taxes, "gst"), pst: num(taxes, "pst"), hst: num(taxes, "hst") },
      due: num(details, "due"),
      options: children(child(details, "options"), "option").map((o) => ({
        code: str(o, "option-code"),
        name: str(o, "option-name"),
        price: num(o, "option-price"),
        included: bool(child(o, "qualifier"), "included"),
      })),
      adjustments: children(child(details, "adjustments"), "adjustment").map((a) => ({
        code: str(a, "adjustment-code"),
        name: str(a, "adjustment-name"),
        cost: num(a, "adjustment-cost"),
        percent: num(child(a, "qualifier"), "percent"),
      })),
    },
    cubedWeight: num(child(node, "weight-details"), "cubed-weight"),
    serviceStandard: {
      amDelivery: bool(standard, "am-delivery"),
      guaranteedDelivery: bool(standard, "guaranteed-delivery"),
      expectedTransitTimeDays: num(standard, "expected-transit-time"),
      expectedDeliveryDate: str(standard, "expected-delivery-date"),
    },
  };
}

function range(node: XmlNode | undefined): DimensionRange {
  return { min: toNumber(attr(node, "min")), max: toNumber(attr(node, "max")) };
}

/** Rating: quotes, service discovery and option lookup. All read-only. */
export class RatingApi {
  constructor(private readonly ctx: ApiContext) {}

  /**
   * Quotes services, prices and transit times for a parcel. Read-only; nothing is purchased.
   * With a configured customer number you get commercial/SSB rates; pass
   * `quoteType: "counter"` for retail prices.
   */
  async getRates(input: GetRatesInput): Promise<GetRatesResult> {
    const { ctx } = this;
    const body = buildMailingScenario(input, {
      customerNumber: ctx.config.customerNumber,
      contractId: ctx.config.contractId,
    });
    const res = await ctx.http.execute({
      operation: "rating.getRates",
      method: "POST",
      url: `${ctx.config.baseUrl}/rs/ship/price`,
      accept: MEDIA_TYPES.rating,
      contentType: MEDIA_TYPES.rating,
      body,
    });
    const root = rootElement(parseXml(res.text), "price-quotes", "rating.getRates");
    const quotes = children(root, "price-quote").map(mapQuote);
    return { quotes, raw: root };
  }

  /** Lists the postal services usable for a destination / customer / contract. */
  async discoverServices(input: DiscoverServicesInput = {}): Promise<DiscoverServicesResult> {
    const { ctx } = this;
    const url =
      `${ctx.config.baseUrl}/rs/ship/service` +
      queryString({
        country: input.country?.toUpperCase(),
        contract: input.contractId ?? ctx.config.contractId,
        origpc:
          input.originPostalCode === undefined
            ? undefined
            : normalizePostalCode(input.originPostalCode),
        destpc:
          input.destinationPostalCode === undefined
            ? undefined
            : normalizePostalCode(input.destinationPostalCode),
      });
    const res = await ctx.http.execute({
      operation: "rating.discoverServices",
      method: "GET",
      url,
      accept: MEDIA_TYPES.rating,
    });
    const root = rootElement(parseXml(res.text), "services", "rating.discoverServices");
    const services = children(root, "service").map((s) => ({
      serviceCode: str(s, "service-code") ?? "",
      serviceName: str(s, "service-name"),
      link: mapLinks(s)[0],
    }));
    return { services, raw: root };
  }

  /**
   * Details, options and restrictions of one service. Accepts a service code (`DOM.EP`), the
   * `service` link returned by {@link RatingApi.getRates} / {@link RatingApi.discoverServices},
   * or a full URL on the environment host.
   */
  async getService(service: LinkOrId, options: { country?: string } = {}): Promise<ServiceDetails> {
    const { ctx } = this;
    const target = resolveTarget(ctx, service, "service code", (id) => `/rs/ship/service/${id}`);
    const url =
      typeof service === "string" && !service.startsWith("http")
        ? `${target.url}${queryString({ country: options.country?.toUpperCase() })}`
        : target.url;
    const res = await ctx.http.execute({
      operation: "rating.getService",
      method: "GET",
      url,
      accept: target.mediaType ?? MEDIA_TYPES.rating,
    });
    const s = rootElement(parseXml(res.text), "service", "rating.getService");
    const r = child(s, "restrictions");
    const dim = child(r, "dimensional-restrictions");
    return {
      serviceCode: str(s, "service-code"),
      serviceName: str(s, "service-name"),
      comment: str(s, "comment"),
      options: children(child(s, "options"), "option").map((o) => ({
        code: str(o, "option-code"),
        name: str(o, "option-name"),
        link: mapLinks(o)[0],
        mandatory: bool(o, "mandatory"),
        qualifierRequired: bool(o, "qualifier-required"),
        qualifierMax: num(o, "qualifier-max"),
      })),
      restrictions: {
        weightGrams: range(child(r, "weight-restriction")),
        length: range(child(dim, "length")),
        width: range(child(dim, "width")),
        height: range(child(dim, "height")),
        lengthPlusGirthMax: num(dim, "length-plus-girth-max"),
        lengthHeightWidthSumMax: num(dim, "length-height-width-sum-max"),
        oversizeLimit: num(dim, "oversize-limit"),
        densityFactor: num(r, "density-factor"),
        canShipInMailingTube: bool(r, "can-ship-in-mailing-tube"),
        canShipUnpackaged: bool(r, "can-ship-unpackaged"),
        allowedAsReturnService: bool(r, "allowed-as-return-service"),
      },
      raw: s,
    };
  }

  /**
   * Details of one option (prerequisites and conflicts). Accepts an option code (`SO`), the
   * `option` link from {@link RatingApi.getService}, or a full URL on the environment host.
   */
  async getOption(option: LinkOrId): Promise<OptionDetails> {
    const { ctx } = this;
    const target = resolveTarget(ctx, option, "option code", (id) => `/rs/ship/option/${id}`);
    const res = await ctx.http.execute({
      operation: "rating.getOption",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.rating,
    });
    const o = rootElement(parseXml(res.text), "option", "rating.getOption");
    return {
      optionCode: str(o, "option-code"),
      optionName: str(o, "option-name"),
      optionClass: str(o, "option-class"),
      printsOnLabel: bool(o, "prints-on-label"),
      qualifierRequired: bool(o, "qualifier-required"),
      conflictingOptions: listCodes(child(o, "conflicting-options")),
      prerequisiteOptions: listCodes(child(o, "prerequisite-options")),
      raw: o,
    };
  }
}

/** `<option-code>` leaf elements repeated under a container. */
function listCodes(container: XmlNode | undefined): string[] {
  if (container === undefined) return [];
  return asArray(container["option-code"]).flatMap((v) => {
    const code = textOf(v);
    return code === undefined ? [] : [code];
  });
}
