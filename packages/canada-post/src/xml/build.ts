import { CanadaPostValidationError } from "../errors.js";

// XML 1.0 forbids most control characters even when escaped; drop them.
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** Escapes text for use in element content or attribute values. */
export function escapeXml(text: string): string {
  return text
    .replace(ILLEGAL_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A value that can appear as XML text. `undefined`/`null` omit the element. */
type XmlScalar = string | number | boolean | undefined | null;

/** Leaf element with escaped text. Returns `""` (no element) for undefined/null. */
export function leaf(name: string, value: XmlScalar): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new CanadaPostValidationError(`<${name}> must be a finite number`);
  }
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** Wrapper element around already-built children. Omitted when every child is empty. */
export function wrap(name: string, ...children: Array<string | undefined>): string {
  const inner = children.join("");
  return inner === "" ? "" : `<${name}>${inner}</${name}>`;
}

/** Complete document with XML declaration and default namespace. */
export function document(root: string, namespace: string, ...children: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><${root} xmlns="${escapeXml(namespace)}">${children.join("")}</${root}>`;
}

/** Formats a number with at most `places` decimals and no exponent or trailing zeros. */
export function decimal(value: number, places: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) {
    throw new CanadaPostValidationError("Numeric value must be finite and below 1e15");
  }
  const fixed = value.toFixed(places);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
