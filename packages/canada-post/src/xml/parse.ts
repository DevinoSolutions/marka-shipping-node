import { XMLParser, XMLValidator } from "fast-xml-parser";
import { CanadaPostParseError } from "../errors.js";

/** A parsed XML element: attributes (`@_name`), text (`#text`) and child elements. */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Canada Post sends numbers, booleans and ids as text. Keep them as strings and convert
  // explicitly: leading zeros in customer numbers and PINs must survive.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/** Parses an XML document into `{ rootName: contents }`. */
export function parseXml(text: string): XmlNode {
  let parsed: unknown;
  try {
    const verdict = XMLValidator.validate(text);
    if (verdict !== true) throw new Error(verdict.err.msg);
    parsed = parser.parse(text);
  } catch (cause) {
    throw new CanadaPostParseError("Response body is not well-formed XML", {
      cause,
      bodyExcerpt: text.slice(0, 500),
    });
  }
  if (!isNode(parsed) || Object.keys(parsed).length === 0) {
    throw new CanadaPostParseError("Response body contains no XML element", {
      bodyExcerpt: text.slice(0, 500),
    });
  }
  return parsed;
}

/** Whether a value is a parsed element with children/attributes (not a leaf string). */
export function isNode(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalises "object or array" XML lists. A missing element or an empty element (`<a/>`,
 * parsed as `""`) is an empty list.
 */
export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

/** Child element as a node, or undefined (also for leaves). If repeated, the first one. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (node === undefined) return undefined;
  const first = asArray(node[name])[0];
  return isNode(first) ? first : undefined;
}

/** All children with the given name, as nodes. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  if (node === undefined) return [];
  return asArray(node[name]).filter(isNode);
}

/** The text of a value that is either a leaf string or an element with attributes + text. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isNode(value)) {
    const t = value["#text"];
    return typeof t === "string" && t !== "" ? t : undefined;
  }
  return undefined;
}

/** Text of a child element; empty elements are undefined. */
export function str(node: XmlNode | undefined, name: string): string | undefined {
  if (node === undefined) return undefined;
  return textOf(asArray(node[name])[0]);
}

/** Numeric text of a child element (Canada Post sends numbers as strings). */
export function num(node: XmlNode | undefined, name: string): number | undefined {
  return toNumber(str(node, name));
}

/** Converts numeric text to a number; non-numeric text becomes undefined. */
export function toNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Boolean text (`true`/`false`/`1`/`0`) of a child element. */
export function bool(node: XmlNode | undefined, name: string): boolean | undefined {
  const v = str(node, name)?.toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

/** Attribute of an element. */
export function attr(node: XmlNode | undefined, name: string): string | undefined {
  const v = node?.[`@_${name}`];
  return typeof v === "string" && v !== "" ? v : undefined;
}
