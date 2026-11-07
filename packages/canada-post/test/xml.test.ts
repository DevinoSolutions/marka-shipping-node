import { describe, expect, it } from "vitest";
import { CanadaPostParseError, CanadaPostValidationError } from "../src/index.js";
import { decimal, document, escapeXml, leaf, wrap } from "../src/xml/build.js";
import { asArray, child, children, num, parseXml, str } from "../src/xml/parse.js";

describe("xml building", () => {
  it("escapes all markup characters in text", () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;",
    );
  });

  it("drops characters that are illegal in XML 1.0", () => {
    expect(escapeXml("a\u0000b\u0008c\u000Bd\u001Fe")).toBe("abcde");
    expect(escapeXml("tab\tnewline\n")).toBe("tab\tnewline\n");
  });

  it("omits elements for undefined and null, keeps false and 0", () => {
    expect(leaf("a", undefined)).toBe("");
    expect(leaf("a", null)).toBe("");
    expect(leaf("a", false)).toBe("<a>false</a>");
    expect(leaf("a", 0)).toBe("<a>0</a>");
  });

  it("rejects non-finite numbers", () => {
    expect(() => leaf("w", Number.NaN)).toThrow(CanadaPostValidationError);
    expect(() => decimal(Number.POSITIVE_INFINITY, 2)).toThrow(CanadaPostValidationError);
  });

  it("wraps only when there is content", () => {
    expect(wrap("x", "", "")).toBe("");
    expect(wrap("x", "<y/>", "")).toBe("<x><y/></x>");
  });

  it("formats decimals without exponents or trailing zeros", () => {
    expect(decimal(1, 3)).toBe("1");
    expect(decimal(1.5, 3)).toBe("1.5");
    expect(decimal(0.000001, 3)).toBe("0");
    expect(() => decimal(1e21, 2)).toThrow(CanadaPostValidationError);
    expect(decimal(100, 2)).toBe("100");
    expect(decimal(12.345, 2)).toMatch(/^12\.3[45]$/);
  });

  it("builds a document with declaration and default namespace", () => {
    expect(document("r", "urn:x", "<c/>")).toBe(
      '<?xml version="1.0" encoding="utf-8"?><r xmlns="urn:x"><c/></r>',
    );
  });
});

describe("xml parsing", () => {
  it("keeps numbers and ids as strings (leading zeros survive)", () => {
    const root = parseXml("<a><id>0001234567</id><n>10.50</n></a>");
    const a = child(root, "a");
    expect(str(a, "id")).toBe("0001234567");
    expect(num(a, "n")).toBe(10.5);
  });

  it("normalises object-or-array lists", () => {
    const one = child(parseXml("<l><i>1</i></l>"), "l");
    const many = child(parseXml("<l><i>1</i><i>2</i></l>"), "l");
    expect(asArray(one?.["i"])).toHaveLength(1);
    expect(asArray(many?.["i"])).toHaveLength(2);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray("")).toEqual([]);
  });

  it("treats empty elements as undefined text", () => {
    const a = child(parseXml("<a><x/><y></y><z>v</z></a>"), "a");
    expect(str(a, "x")).toBeUndefined();
    expect(str(a, "y")).toBeUndefined();
    expect(str(a, "z")).toBe("v");
  });

  it("strips namespace prefixes and reads attributes", () => {
    const root = parseXml('<ns:a xmlns:ns="urn:x"><ns:link rel="self" href="h"/></ns:a>');
    expect(children(child(root, "a"), "link")[0]?.["@_rel"]).toBe("self");
  });

  it("decodes entities", () => {
    const a = child(parseXml("<a><t>Tom &amp; Jerry &lt;3</t></a>"), "a");
    expect(str(a, "t")).toBe("Tom & Jerry <3");
  });

  it("throws CanadaPostParseError for text that is not XML", () => {
    expect(() => parseXml("not xml at all")).toThrow(CanadaPostParseError);
    expect(() => parseXml("")).toThrow(CanadaPostParseError);
  });
});
