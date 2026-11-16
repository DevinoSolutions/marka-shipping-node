import { describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  CanadaPostConfigurationError,
  CanadaPostError,
  CanadaPostParseError,
  CanadaPostValidationError,
  findRestLink,
  requireRestLink,
} from "../src/index.js";
import {
  FAKE_CREATE_RESPONSE,
  FAKE_DETAILS,
  FAKE_LINKS,
  FAKE_PRICE,
  FAKE_SHIPMENT_ID,
  PDF_HEADERS,
  SHIPPING,
  TEST_CUSTOMER,
  bodyOf,
  fakeCreateRequest,
  fakePdf,
  firstApi,
  json,
  makeRestClient,
} from "./support/rest.js";

const SHIPMENTS = `${SHIPPING}/${TEST_CUSTOMER}/${TEST_CUSTOMER}/shipments`;

describe("shipments.create", () => {
  it("POSTs the request body as JSON to the account's shipments URL", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE));
    const request = fakeCreateRequest();
    const created = await h.client.shipments.create(request);
    const sent = firstApi(h);
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(SHIPMENTS);
    expect(sent.headers["content-type"]).toBe("application/json");
    expect(bodyOf(sent)).toEqual(request);
    expect(created).toEqual(FAKE_CREATE_RESPONSE);
  });

  it("uses the mobo customer number in the path when given", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE), { overrides: { mobo: "7654321" } });
    await h.client.shipments.create(fakeCreateRequest());
    expect(firstApi(h).url).toBe(`${SHIPPING}/${TEST_CUSTOMER}/7654321/shipments`);
  });

  it("accepts a groupId instead of transmitShipment", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE));
    const request = fakeCreateRequest();
    const { transmitShipment: _t, ...rest } = request as {
      transmitShipment?: true;
    } & typeof request;
    await h.client.shipments.create({ ...rest, groupId: "GROUP1" } as never);
    expect(bodyOf(firstApi(h))).toMatchObject({ groupId: "GROUP1" });
  });

  it("sends X-CPC-Zonos-Key from the option, the client default, or not at all", async () => {
    const withOption = makeRestClient(json(FAKE_CREATE_RESPONSE), {
      overrides: { zonosKey: "zonos-default-key" },
    });
    await withOption.client.shipments.create(fakeCreateRequest(), { zonosKey: "zonos-call-key" });
    expect(firstApi(withOption).headers["x-cpc-zonos-key"]).toBe("zonos-call-key");

    const withDefault = makeRestClient(json(FAKE_CREATE_RESPONSE), {
      overrides: { zonosKey: "zonos-default-key" },
    });
    await withDefault.client.shipments.create(fakeCreateRequest());
    expect(firstApi(withDefault).headers["x-cpc-zonos-key"]).toBe("zonos-default-key");

    const none = makeRestClient(json(FAKE_CREATE_RESPONSE));
    await none.client.shipments.create(fakeCreateRequest());
    expect(firstApi(none).headers["x-cpc-zonos-key"]).toBeUndefined();
  });

  it("keeps the Zonos key out of errors", async () => {
    const h = makeRestClient(json({ title: "x", detail: "key zonos-default-key rejected" }, 400), {
      overrides: { zonosKey: "zonos-default-key" },
    });
    const error = (await h.client.shipments
      .create(fakeCreateRequest())
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(JSON.stringify([error.message, error.bodyExcerpt, error.detail])).not.toContain(
      "zonos-default-key",
    );
  });
});

describe("reading shipments", () => {
  it("gets a shipment by id", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE));
    const info = await h.client.shipments.get(FAKE_SHIPMENT_ID);
    expect(firstApi(h).method).toBe("GET");
    expect(firstApi(h).url).toBe(`${SHIPMENTS}/${FAKE_SHIPMENT_ID}`);
    expect(info.shipmentId).toBe(FAKE_SHIPMENT_ID);
  });

  it("gets details and price by id", async () => {
    const h = makeRestClient((request) =>
      request.url.endsWith("/details") ? json(FAKE_DETAILS) : json(FAKE_PRICE),
    );
    await expect(h.client.shipments.getDetails(FAKE_SHIPMENT_ID)).resolves.toEqual(FAKE_DETAILS);
    await expect(h.client.shipments.getPrice(FAKE_SHIPMENT_ID)).resolves.toEqual(FAKE_PRICE);
    expect(h.apiRequests().map((r) => r.url)).toEqual([
      `${SHIPMENTS}/${FAKE_SHIPMENT_ID}/details`,
      `${SHIPMENTS}/${FAKE_SHIPMENT_ID}/price`,
    ]);
  });

  it("follows the details and price LINKS exactly as given", async () => {
    const h = makeRestClient((request) =>
      request.url.endsWith("/details") ? json(FAKE_DETAILS) : json(FAKE_PRICE),
    );
    const details = requireRestLink(FAKE_LINKS, "details");
    const price = requireRestLink(FAKE_LINKS, "price");
    await h.client.shipments.getDetails(details);
    await h.client.shipments.getPrice(price);
    expect(h.apiRequests().map((r) => r.url)).toEqual([details.href, price.href]);
  });

  it("unwraps the one-element arrays the Test app returns for details and price", async () => {
    const h = makeRestClient((request) =>
      request.url.endsWith("/details") ? json([FAKE_DETAILS]) : json([FAKE_PRICE]),
    );
    await expect(h.client.shipments.getDetails(FAKE_SHIPMENT_ID)).resolves.toEqual(FAKE_DETAILS);
    await expect(h.client.shipments.getPrice(FAKE_SHIPMENT_ID)).resolves.toEqual(FAKE_PRICE);
  });

  it("rejects details/price bodies that are neither an object nor a one-element array", async () => {
    for (const body of [[], [FAKE_PRICE, FAKE_PRICE], "text", 7, null, [[1]]]) {
      const h = makeRestClient(json(body));
      await expect(h.client.shipments.getPrice(FAKE_SHIPMENT_ID)).rejects.toBeInstanceOf(
        CanadaPostParseError,
      );
    }
  });

  it("rejects a non-JSON success body without echoing it", async () => {
    const h = makeRestClient({ status: 200, body: "<html>maintenance page</html>" });
    const error = (await h.client.shipments
      .get(FAKE_SHIPMENT_ID)
      .catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(CanadaPostParseError);
    expect(error.message).not.toContain("maintenance");
  });

  it("validates ids before putting them in a URL", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE));
    for (const id of ["", "../etc", "a/b", "a?b=c", "x".repeat(65), "a b", "%2e%2e", "a.b"]) {
      await expect(h.client.shipments.get(id)).rejects.toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.mock.requests).toHaveLength(0);
  });

  it("refuses foreign-host links for every link-taking method", async () => {
    const h = makeRestClient(json({}));
    const evil = { rel: "self", href: "https://evil.example/x", mediaType: "application/json" };
    await expect(h.client.shipments.get(evil)).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    await expect(h.client.shipments.getDetails(evil)).rejects.toBeInstanceOf(
      CanadaPostConfigurationError,
    );
    await expect(h.client.shipments.getPrice(evil)).rejects.toBeInstanceOf(
      CanadaPostConfigurationError,
    );
    await expect(h.client.shipments.void(evil)).rejects.toBeInstanceOf(
      CanadaPostConfigurationError,
    );
    await expect(h.client.shipments.getLabel(evil)).rejects.toBeInstanceOf(
      CanadaPostConfigurationError,
    );
    await expect(
      h.client.shipments.getLabel({ links: [{ ...evil, rel: "label" }] }),
    ).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    expect(h.mock.requests).toHaveLength(0);
  });
});

describe("shipments.list", () => {
  it("queries by customerRequestId and returns the shipment links", async () => {
    const h = makeRestClient(json([FAKE_LINKS[0]]));
    const links = await h.client.shipments.list({ requestId: "REQ-0001" });
    expect(links).toHaveLength(1);
    expect(firstApi(h).url).toBe(`${SHIPMENTS}?request-id=REQ-0001`);
  });

  it("encodes every filter", async () => {
    const h = makeRestClient(json([]));
    await h.client.shipments.list({
      trackingPin: "1234567890123456",
      groupId: "G 1",
      manifestId: "M1",
      noManifest: true,
      date: "2026-12-01",
      limit: 5,
    });
    const url = new URL(firstApi(h).url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "tracking-pin": "1234567890123456",
      "group-id": "G 1",
      "manifest-id": "M1",
      "no-manifest": "true",
      date: "20261201",
      limit: "5",
    });
  });

  it("needs a search filter: date and limit only narrow another filter", async () => {
    const h = makeRestClient(json([]));
    for (const input of [
      {},
      { date: "2026-12-01" },
      { limit: 5 },
      { date: "20261201", limit: 5 },
    ]) {
      await expect(h.client.shipments.list(input)).rejects.toBeInstanceOf(
        CanadaPostValidationError,
      );
    }
    expect(h.mock.requests).toHaveLength(0);
    await h.client.shipments.list({ noManifest: true, date: "2026-12-01" });
    expect(new URL(firstApi(h).url).search).toBe("?no-manifest=true&date=20261201");
  });

  it("surfaces HTTP 202 as a pending API error", async () => {
    const h = makeRestClient({ status: 202, body: "" });
    const error = (await h.client.shipments
      .list({ requestId: "R" })
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(error.isPending).toBe(true);
  });

  it("rejects bodies that are not link lists", async () => {
    for (const body of [{ a: 1 }, [1, 2], [{ rel: "x" }]]) {
      const h = makeRestClient(json(body));
      await expect(h.client.shipments.list({ requestId: "R" })).rejects.toBeInstanceOf(
        CanadaPostParseError,
      );
    }
  });
});

describe("shipments.void", () => {
  it("DELETEs by id and by self link; 204 resolves", async () => {
    const h = makeRestClient({ status: 204 });
    await expect(h.client.shipments.void(FAKE_SHIPMENT_ID)).resolves.toBeUndefined();
    await expect(
      h.client.shipments.void(requireRestLink(FAKE_LINKS, "self")),
    ).resolves.toBeUndefined();
    expect(h.apiRequests().map((r) => [r.method, r.url])).toEqual([
      ["DELETE", `${SHIPMENTS}/${FAKE_SHIPMENT_ID}`],
      ["DELETE", `${SHIPMENTS}/${FAKE_SHIPMENT_ID}`],
    ]);
    expect(firstApi(h).headers["content-type"]).toBeUndefined();
  });

  it("maps a documented 400", async () => {
    const h = makeRestClient(
      json(
        {
          title: "Cannot void",
          detail: "already transmitted",
          errors: [{ errorCode: "V1", message: "transmitted" }],
        },
        400,
      ),
    );
    const error = (await h.client.shipments
      .void(FAKE_SHIPMENT_ID)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(error.code).toBe("V1");
  });
});

describe("shipments.getLabel", () => {
  const pdf = fakePdf(3);
  const pdfReply = { status: 200, body: pdf, headers: PDF_HEADERS };

  it("downloads from the label link of a create response with the link's media type", async () => {
    const h = makeRestClient(pdfReply);
    const label = await h.client.shipments.getLabel(FAKE_CREATE_RESPONSE);
    const sent = firstApi(h);
    expect(sent.url).toBe(requireRestLink(FAKE_LINKS, "label").href);
    expect(sent.headers["accept"]).toBe("application/pdf");
    expect(label.contentType).toBe("application/pdf");
    expect(Array.from(label.data)).toEqual(Array.from(pdf));
  });

  it("looks the shipment up first when given only an id", async () => {
    const h = makeRestClient((request) =>
      request.url.includes("/artifacts/") ? pdfReply : json(FAKE_CREATE_RESPONSE),
    );
    const label = await h.client.shipments.getLabel(FAKE_SHIPMENT_ID);
    expect(h.apiRequests()).toHaveLength(2);
    expect(h.apiRequests()[0]?.url).toBe(`${SHIPMENTS}/${FAKE_SHIPMENT_ID}`);
    expect(label.data.byteLength).toBe(pdf.byteLength);
  });

  it("accepts the label link itself and strips content-type parameters", async () => {
    const h = makeRestClient({
      status: 200,
      body: pdf,
      headers: { "content-type": "Application/PDF; charset=binary" },
    });
    const label = await h.client.shipments.getLabel(requireRestLink(FAKE_LINKS, "label"));
    expect(label.contentType).toBe("application/pdf");
  });

  it("returns ZPL labels", async () => {
    const zpl = new TextEncoder().encode("^XA^FO50,50^FDHELLO^FS^XZ");
    const h = makeRestClient({
      status: 200,
      body: zpl,
      headers: { "content-type": "application/zpl" },
    });
    const label = await h.client.shipments.getLabel({
      rel: "label",
      href: requireRestLink(FAKE_LINKS, "label").href,
      mediaType: "application/zpl",
    });
    expect(label.contentType).toBe("application/zpl");
    expect(h.apiRequests()[0]?.headers["accept"]).toBe("application/zpl");
  });

  it("fails clearly when the response has no label link", async () => {
    const h = makeRestClient(json(FAKE_CREATE_RESPONSE));
    await expect(h.client.shipments.getLabel({ links: FAKE_LINKS.slice(0, 2) })).rejects.toThrow(
      /no rel="label" link/,
    );
    expect(h.mock.requests).toHaveLength(0);
  });

  it("never returns an HTML page, an empty body or a non-PDF as a label", async () => {
    const link = requireRestLink(FAKE_LINKS, "label");
    const cases = [
      { status: 200, body: "<html>error</html>", headers: { "content-type": "text/html" } },
      { status: 200, body: "<html>error</html>", headers: PDF_HEADERS },
      { status: 200, body: "", headers: PDF_HEADERS },
      { status: 200, body: pdf },
    ];
    for (const reply of cases) {
      const h = makeRestClient(reply);
      await expect(h.client.shipments.getLabel(link)).rejects.toBeInstanceOf(CanadaPostError);
    }
  });

  it("treats HTTP 202 as a pending API error", async () => {
    const h = makeRestClient({ status: 202, body: "" });
    const error = (await h.client.shipments
      .getLabel(requireRestLink(FAKE_LINKS, "label"))
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(error.isPending).toBe(true);
  });

  it("maps an error response to a typed error", async () => {
    const h = makeRestClient(json({ title: "Gone", detail: "expired", errors: [] }, 404));
    await expect(
      h.client.shipments.getLabel(requireRestLink(FAKE_LINKS, "label")),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("link helpers", () => {
  it("finds links case-insensitively", () => {
    expect(findRestLink(FAKE_LINKS, "LABEL")?.rel).toBe("label");
    expect(findRestLink(FAKE_LINKS, "nope")).toBeUndefined();
    expect(() => requireRestLink(FAKE_LINKS, "nope")).toThrow(
      /links present: self, details, price, label/,
    );
    expect(() => requireRestLink([], "nope")).toThrow(/links present: none/);
  });
});
