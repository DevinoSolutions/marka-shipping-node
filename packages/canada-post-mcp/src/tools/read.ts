/** Read-only tools: quotes, tracking, shipment lookups, labels, manifests, customer readiness. */
import { z } from "zod";
import type { RestPriceRequest } from "@joinmarka/canada-post";
import { ArtifactPathError, saveArtifact } from "./files.js";
import {
  isoDate,
  parcelCharacteristics,
  pin,
  postalCode,
  quoteDestination,
  resourceId,
} from "./schemas.js";
import {
  defineTool,
  errorResult,
  guarded,
  linkViews,
  mapErrorToPayload,
  okResult,
  type ToolDefinition,
  type ToolResult,
} from "./shared.js";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const quoteInput = z.strictObject({
  originPostalCode: postalCode,
  destination: quoteDestination,
  parcelCharacteristics,
  services: z
    .array(z.string().min(1).max(32))
    .max(20)
    .optional()
    .describe("Only quote these service codes (for example DOM.EP)."),
  quoteType: z.enum(["commercial", "counter"]).optional().describe("Contract or retail rates."),
  expectedMailingDate: isoDate.optional(),
  options: z
    .array(
      z.strictObject({
        optionCode: z.string().min(1).max(10),
        optionAmount: z.number().optional(),
      }),
    )
    .max(20)
    .optional(),
});

/** Normalizes a quote request the way both the quote tool and the shipment preview send it. */
function toPriceRequest(input: z.infer<typeof quoteInput>): RestPriceRequest {
  return {
    ...input,
    originPostalCode: input.originPostalCode.replace(/\s+/g, "").toUpperCase(),
    destination: input.destination.domestic
      ? {
          domestic: {
            postalCode: input.destination.domestic.postalCode.replace(/\s+/g, "").toUpperCase(),
          },
        }
      : input.destination,
  } as RestPriceRequest;
}

const quoteTool = defineTool({
  name: "canadapost_quote",
  title: "Quote shipping prices",
  description:
    "Prices a parcel for one or more Canada Post services (rating). Free; creates nothing. " +
    "A Test app answers a canned quote whatever you send.",
  annotations: { title: "Quote shipping prices", ...READ_ONLY },
  inputSchema: quoteInput,
  handler: (input, ctx) =>
    guarded(ctx, async () => {
      const quotes = await ctx.client.rating.getPrices(toPriceRequest(input));
      return { app: ctx.config.app, quotes };
    }),
});

const servicesListTool = defineTool({
  name: "canadapost_services_list",
  title: "List Canada Post services",
  description: "Lists the services available for a destination country (default CA).",
  annotations: { title: "List Canada Post services", ...READ_ONLY },
  inputSchema: z.strictObject({
    country: z.string().length(2).optional().describe("ISO country code of the destination."),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({
      services: await ctx.client.rating.listServices(
        input.country === undefined ? {} : { country: input.country.toUpperCase() },
      ),
    })),
});

const serviceGetTool = defineTool({
  name: "canadapost_service_get",
  title: "Get a Canada Post service",
  description: "Options and restrictions (weight, dimensions) of one service code such as DOM.EP.",
  annotations: { title: "Get a Canada Post service", ...READ_ONLY },
  inputSchema: z.strictObject({
    serviceCode: z
      .string()
      .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/)
      .max(32),
    country: z.string().length(2).optional(),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({
      service: await ctx.client.rating.getService(
        input.serviceCode,
        input.country === undefined ? {} : { country: input.country.toUpperCase() },
      ),
    })),
});

const optionGetTool = defineTool({
  name: "canadapost_option_get",
  title: "Get a shipment option",
  description: "Describes one option code (for example DC delivery confirmation, COV coverage).",
  annotations: { title: "Get a shipment option", ...READ_ONLY },
  inputSchema: z.strictObject({ optionCode: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({ option: await ctx.client.rating.getOption(input.optionCode) })),
});

const trackByPinTool = defineTool({
  name: "canadapost_track_by_pin",
  title: "Track a parcel by PIN",
  description:
    "Latest tracking event (or the full history with detail=true) of a parcel. Tracking works " +
    "even before the account is linked. An unknown PIN comes back as an entry with an `error`.",
  annotations: { title: "Track a parcel by PIN", ...READ_ONLY },
  inputSchema: z.strictObject({ pin, detail: z.boolean().optional() }),
  handler: (input, ctx) =>
    guarded(ctx, async () =>
      input.detail === true
        ? { details: await ctx.client.tracking.getDetailsByPin(input.pin) }
        : { summary: await ctx.client.tracking.getSummaryByPin(input.pin) },
    ),
});

const trackByDncTool = defineTool({
  name: "canadapost_track_by_dnc",
  title: "Track a parcel by delivery notice card",
  description: "Tracking by the 15-digit number on a delivery notice card (DNC).",
  annotations: { title: "Track by delivery notice card", ...READ_ONLY },
  inputSchema: z.strictObject({
    dnc: z.string().regex(/^\d{15}$/, "15 digits"),
    detail: z.boolean().optional(),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () =>
      input.detail === true
        ? { details: await ctx.client.tracking.getDetailsByDnc(input.dnc) }
        : { summary: await ctx.client.tracking.getSummaryByDnc(input.dnc) },
    ),
});

const trackByReferenceTool = defineTool({
  name: "canadapost_track_by_reference",
  title: "Track parcels by reference",
  description:
    "Latest event of every parcel shipped with a customer reference in a mailing-date window " +
    "(not earlier than two months ago).",
  annotations: { title: "Track parcels by reference", ...READ_ONLY },
  inputSchema: z.strictObject({
    referenceNumber: z.string().min(1).max(35),
    mailingDateFrom: isoDate,
    mailingDateTo: isoDate,
    destinationPostalCode: z.string().min(1).max(14).optional(),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({
      summary: await ctx.client.tracking.getSummaryByReference(input),
    })),
});

const shipmentGetTool = defineTool({
  name: "canadapost_shipment_get",
  title: "Get a shipment",
  description: "Status, tracking PIN and links of a shipment created with this account.",
  annotations: { title: "Get a shipment", ...READ_ONLY },
  inputSchema: z.strictObject({ shipmentId: resourceId }),
  handler: (input, ctx) =>
    guarded(ctx, async () => {
      const info = await ctx.client.shipments.get(input.shipmentId);
      return { shipment: { ...info, links: linkViews(info.links) } };
    }),
});

const shipmentDetailsTool = defineTool({
  name: "canadapost_shipment_details",
  title: "Get shipment details",
  description: "The delivery spec (addresses, parcel, service) and state of a shipment.",
  annotations: { title: "Get shipment details", ...READ_ONLY },
  inputSchema: z.strictObject({ shipmentId: resourceId }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({
      details: await ctx.client.shipments.getDetails(input.shipmentId),
    })),
});

const shipmentPriceTool = defineTool({
  name: "canadapost_shipment_price",
  title: "Get the price of a shipment",
  description: "What a shipment cost (base, options, taxes, total due), in CAD.",
  annotations: { title: "Get the price of a shipment", ...READ_ONLY },
  inputSchema: z.strictObject({ shipmentId: resourceId }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({ price: await ctx.client.shipments.getPrice(input.shipmentId) })),
});

const shipmentReceiptTool = defineTool({
  name: "canadapost_shipment_receipt",
  title: "Get a shipment receipt",
  description:
    "The payment receipt of a shipment (merchant, authorization, amount). No card number.",
  annotations: { title: "Get a shipment receipt", ...READ_ONLY },
  inputSchema: z.strictObject({ shipmentId: resourceId }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({
      receipt: await ctx.client.shipments.getReceipt(input.shipmentId),
    })),
});

const shipmentLabelTool = defineTool({
  name: "canadapost_shipment_label",
  title: "Save a shipment label to a file",
  description:
    "Downloads the label of a shipment and saves it to a file; returns the file path, never the " +
    "label bytes. Without `path` it is saved in a temp directory (or CANADAPOST_MCP_OUTPUT_DIR). " +
    "An existing file is never overwritten.",
  annotations: { title: "Save a shipment label to a file", ...READ_ONLY },
  inputSchema: z.strictObject({
    shipmentId: resourceId,
    path: z.string().min(1).max(500).optional().describe("Absolute path ending in .pdf or .zpl."),
  }),
  handler: async (input, ctx): Promise<ToolResult> => {
    try {
      const artifact = await ctx.client.shipments.getLabel(input.shipmentId);
      const saved = await saveArtifact(artifact, {
        outputDir: ctx.config.outputDir,
        restrictToOutputDir: ctx.config.outputDirRestricted,
        baseName: `label-${input.shipmentId}`,
        now: ctx.now(),
        ...(input.path === undefined ? {} : { requestedPath: input.path }),
      });
      return okResult({ label: saved });
    } catch (error) {
      if (error instanceof ArtifactPathError) return errorResult(error.payload);
      return errorResult(mapErrorToPayload(error, ctx));
    }
  },
});

const shipmentsListTool = defineTool({
  name: "canadapost_shipments_list",
  title: "List shipments",
  description:
    "Finds shipments by customerRequestId, tracking PIN, group, manifest, or those not yet on " +
    "a manifest. At least one of requestId, trackingPin, groupId, manifestId or noManifest is " +
    "required; date and limit only narrow another filter.",
  annotations: { title: "List shipments", ...READ_ONLY },
  inputSchema: z.strictObject({
    requestId: z.string().min(1).max(32).optional(),
    trackingPin: pin.optional(),
    groupId: z.string().min(1).max(32).optional(),
    manifestId: z.string().min(1).max(32).optional(),
    noManifest: z.boolean().optional(),
    date: isoDate.optional(),
    limit: z.number().int().min(1).max(99999).optional(),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({ shipments: linkViews(await ctx.client.shipments.list(input)) })),
});

const groupsListTool = defineTool({
  name: "canadapost_groups_list",
  title: "List shipment groups",
  description: "The shipment groups of the account (a manifest transmits groups).",
  annotations: { title: "List shipment groups", ...READ_ONLY },
  inputSchema: z.strictObject({}),
  handler: (_input, ctx) =>
    guarded(ctx, async () => {
      const groups = await ctx.client.shipments.getGroups();
      return { groups: groups.map((g) => ({ groupId: g.groupId, link: linkViews([g.link])[0] })) };
    }),
});

const manifestsListTool = defineTool({
  name: "canadapost_manifests_list",
  title: "List manifests",
  description: "Links to the manifests of a date range (`from` is required, `to` optional).",
  annotations: { title: "List manifests", ...READ_ONLY },
  inputSchema: z.strictObject({ from: isoDate, to: isoDate.optional() }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({ manifests: linkViews(await ctx.client.manifests.list(input)) })),
});

const manifestGetTool = defineTool({
  name: "canadapost_manifest_get",
  title: "Get a manifest",
  description:
    "A manifest's PO number, links and (with details=true) shipping point, payment and cost.",
  annotations: { title: "Get a manifest", ...READ_ONLY },
  inputSchema: z.strictObject({ manifestId: resourceId, details: z.boolean().optional() }),
  handler: (input, ctx) =>
    guarded(ctx, async () => {
      const manifest = await ctx.client.manifests.get(input.manifestId);
      return {
        manifest: { ...manifest, links: linkViews(manifest.links) },
        ...(input.details === true
          ? { details: await ctx.client.manifests.getDetails(input.manifestId) }
          : {}),
      };
    }),
});

const paymentReadinessTool = defineTool({
  name: "canadapost_customer_payment_readiness",
  title: "Check payment readiness",
  description:
    "Whether the account can pay for labels: a credit card on file, number of contracts and " +
    "authorized payers, payment methods. Never returns card data. Use it to see whether a newly " +
    "added card or an organization link has taken effect.",
  annotations: { title: "Check payment readiness", ...READ_ONLY },
  inputSchema: z.strictObject({}),
  handler: (_input, ctx) =>
    guarded(ctx, async () => ({ readiness: await ctx.client.customers.getPaymentReadiness() })),
});

const postOfficesTool = defineTool({
  name: "canadapost_post_offices_find",
  title: "Find post offices",
  description: "Post offices nearest to a postal code, with distance and opening-hours links.",
  annotations: { title: "Find post offices", ...READ_ONLY },
  inputSchema: z.strictObject({
    postalCode,
    maximum: z.number().int().min(1).max(50).optional(),
    d2po: z.boolean().optional().describe("Only offices that accept Delivered-to-Post-Office."),
    tonight: z.boolean().optional().describe("Only offices open tonight."),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({ postOffices: await ctx.client.postOffices.find(input) })),
});

const pickupAvailabilityTool = defineTool({
  name: "canadapost_pickup_availability",
  title: "Check pickup availability",
  description: "Whether on-demand pickups are available at a postal code, and the cut-off time.",
  annotations: { title: "Check pickup availability", ...READ_ONLY },
  inputSchema: z.strictObject({ postalCode }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({
      availability: await ctx.client.pickup.getAvailability(input.postalCode),
    })),
});

const pickupPriceTool = defineTool({
  name: "canadapost_pickup_price",
  title: "Price an on-demand pickup",
  description: "What an on-demand pickup on a date would cost. Free to call; books nothing.",
  annotations: { title: "Price an on-demand pickup", ...READ_ONLY },
  inputSchema: z.strictObject({
    date: isoDate,
    contractId: z
      .string()
      .regex(/^\d{1,10}$/)
      .optional(),
    priorityFlag: z.boolean().optional(),
    alternateAddressPostalCode: postalCode.optional(),
  }),
  handler: (input, ctx) =>
    guarded(ctx, async () => ({ price: await ctx.client.pickup.getPrice(input) })),
});

/** Every read-only tool. */
export const READ_TOOLS: readonly ToolDefinition[] = [
  quoteTool,
  servicesListTool,
  serviceGetTool,
  optionGetTool,
  trackByPinTool,
  trackByDncTool,
  trackByReferenceTool,
  shipmentGetTool,
  shipmentDetailsTool,
  shipmentPriceTool,
  shipmentReceiptTool,
  shipmentLabelTool,
  shipmentsListTool,
  groupsListTool,
  manifestsListTool,
  manifestGetTool,
  paymentReadinessTool,
  postOfficesTool,
  pickupAvailabilityTool,
  pickupPriceTool,
] as unknown as readonly ToolDefinition[];
