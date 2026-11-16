/** zod schemas shared by the read and write tools. Everything is strict: unknown keys are rejected. */
import { z } from "zod";

export const postalCode = z
  .string()
  .regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, "Canadian postal code such as K1A0B1")
  .describe("Canadian postal code, with or without a space.");

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .describe("A date as YYYY-MM-DD.");

/** A shipment id, pickup request id or similar path segment. */
export const resourceId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "letters, digits, underscore or hyphen (max 64)")
  .describe("The id returned by Canada Post.");

export const pin = z
  .string()
  .regex(/^[A-Za-z0-9]{11,16}$/, "11-16 letters or digits")
  .describe("Parcel identification number (tracking PIN).");

const dimensions = z.strictObject({
  length: z.number().positive().max(999.9).describe("Centimetres."),
  width: z.number().positive().max(999.9).describe("Centimetres."),
  height: z.number().positive().max(999.9).describe("Centimetres."),
});

export const parcelCharacteristics = z.strictObject({
  weight: z.number().positive().max(999.999).describe("Kilograms."),
  dimensions: dimensions.optional(),
  unpackaged: z.boolean().optional(),
  mailingTube: z.boolean().optional(),
  oversized: z.boolean().optional(),
});

export const quoteDestination = z
  .strictObject({
    domestic: z.strictObject({ postalCode }).optional(),
    unitedStates: z.strictObject({ zipCode: z.string().min(5).max(10) }).optional(),
    international: z
      .strictObject({
        countryCode: z.string().length(2).describe("ISO 3166-1 alpha-2."),
        postalCode: z.string().max(14).optional(),
      })
      .optional(),
  })
  .refine(
    (d) =>
      [d.domestic, d.unitedStates, d.international].filter((x) => x !== undefined).length === 1,
    { message: "give exactly one of domestic, unitedStates or international" },
  );

const returnAddress = z.strictObject({
  addressLine1: z.string().min(1).max(44),
  addressLine2: z.string().max(44).optional(),
  city: z.string().min(1).max(40),
  province: z.string().length(2).describe("Two-letter province code."),
  postalCode: z.string().regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/, "upper case, no space"),
});

export const returnParty = z.strictObject({
  name: z.string().min(1).max(44),
  company: z.string().min(1).max(44).optional(),
  domesticAddress: returnAddress,
});

export const emailAddress = z
  .string()
  .max(60)
  .regex(/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/, "e-mail");
