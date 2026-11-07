// XML fixtures transcribed from the official Canada Post Developer Program examples
// (see docs/research/canadapost-api-contracts.md for the page of each one). All names,
// addresses, customer numbers and PINs are fake placeholders; the documented sandbox PIN
// 123456789012 is the only PIN used.
const HOST = "https://ct.soa-gw.canadapost.ca";

export const FIXTURE_HOST = HOST;

/** getrates.jsf - Sample REST XML Response (two quotes, trimmed). */
export const RATES_RESPONSE = `<price-quotes>
<price-quote>
<service-code>DOM.EP</service-code>
<service-link rel="service" href="${HOST}/rs/ship/service/DOM.EP?country=CA" media-type="application/vnd.cpc.ship.rate-v4+xml"></service-link>
<service-name>Expedited Parcel</service-name>
<price-details>
<base>9.59</base>
<taxes><gst>0.00</gst><pst>0</pst><hst>0</hst></taxes>
<due>10.21</due>
<options>
<option><option-code>DC</option-code><option-name>Delivery confirmation</option-name><option-price>0</option-price></option>
</options>
<adjustments>
<adjustment><adjustment-code>AUTDISC</adjustment-code><adjustment-name>Automation discount</adjustment-name><adjustment-cost>-0.29</adjustment-cost><qualifier><percent>3.000</percent></qualifier></adjustment>
<adjustment><adjustment-code>FUELSC</adjustment-code><adjustment-name>Fuel surcharge</adjustment-name><adjustment-cost>0.91</adjustment-cost><qualifier><percent>9.75</percent></qualifier></adjustment>
</adjustments>
</price-details>
<weight-details></weight-details>
<service-standard>
<am-delivery>false</am-delivery>
<guaranteed-delivery>true</guaranteed-delivery>
<expected-transit-time>2</expected-transit-time>
<expected-delivery-date>2011-10-24</expected-delivery-date>
</service-standard>
</price-quote>
<price-quote>
<service-code>DOM.RP</service-code>
<service-link rel="service" href="${HOST}/rs/ship/service/DOM.RP?country=CA" media-type="application/vnd.cpc.ship.rate-v4+xml"></service-link>
<service-name>Regular Parcel</service-name>
<price-details>
<base>9.59</base>
<taxes><gst>0.00</gst><pst>0</pst><hst>0</hst></taxes>
<due>10.21</due>
<options>
<option><option-code>DC</option-code><option-name>Delivery confirmation</option-name><option-price>0</option-price><qualifier><included>true</included></qualifier></option>
</options>
</price-details>
<weight-details><cubed-weight>1.5</cubed-weight></weight-details>
<service-standard>
<am-delivery>false</am-delivery>
<guaranteed-delivery>false</guaranteed-delivery>
<expected-transit-time>4</expected-transit-time>
<expected-delivery-date>2011-10-26</expected-delivery-date>
</service-standard>
</price-quote>
</price-quotes>`;

/** The same response with exactly one quote and one option/adjustment (object, not array). */
export const RATES_RESPONSE_SINGLE = `<price-quotes>
<price-quote>
<service-code>DOM.XP</service-code>
<service-link rel="service" href="${HOST}/rs/ship/service/DOM.XP?country=CA" media-type="application/vnd.cpc.ship.rate-v4+xml"></service-link>
<service-name>Xpresspost</service-name>
<price-details>
<base>12.26</base>
<taxes><gst>0.00</gst><pst>0</pst><hst>0</hst></taxes>
<due>13.64</due>
<options><option><option-code>DC</option-code><option-name>Delivery confirmation</option-name><option-price>0</option-price></option></options>
<adjustments><adjustment><adjustment-code>FUELSC</adjustment-code><adjustment-name>Fuel surcharge</adjustment-name><adjustment-cost>1.75</adjustment-cost><qualifier><percent>14.75</percent></qualifier></adjustment></adjustments>
</price-details>
<weight-details></weight-details>
<service-standard><am-delivery>false</am-delivery><guaranteed-delivery>true</guaranteed-delivery><expected-transit-time>2</expected-transit-time><expected-delivery-date>2011-10-24</expected-delivery-date></service-standard>
</price-quote>
</price-quotes>`;

/** discoverservices.jsf - Sample response (the doc omits the opening tag; the XSD defines it). */
export const DISCOVER_RESPONSE = `<services>
<service>
<service-code>INT.XP</service-code>
<service-name>Xpresspost International</service-name>
<link rel="service" href="${HOST}/rs/ship/service/INT.XP?country=JP" media-type="application/vnd.cpc.ship.rate-v4+xml"></link>
</service>
<service>
<service-code>INT.SP.SURF</service-code>
<service-name>Small Packet International Surface</service-name>
<link rel="service" href="${HOST}/rs/ship/service/INT.SP.SURF?country=JP" media-type="application/vnd.cpc.ship.rate-v4+xml"></link>
</service>
</services>`;

/** getservices.jsf - Sample response. */
export const SERVICE_RESPONSE = `<service>
<service-code>INT.XP</service-code>
<service-name>Xpresspost International</service-name>
<options>
<option>
<option-code>COV</option-code>
<option-name>Coverage</option-name>
<link rel="option" href="${HOST}/rs/ship/option/COV" media-type="application/vnd.cpc.ship.rate-v4+xml"></link>
<mandatory>false</mandatory>
<qualifier-required>true</qualifier-required>
<qualifier-max>1000</qualifier-max>
</option>
<option>
<option-code>DC</option-code>
<option-name>Delivery confirmation</option-name>
<link rel="option" href="${HOST}/rs/ship/option/DC" media-type="application/vnd.cpc.ship.rate-v4+xml"></link>
<mandatory>true</mandatory>
<qualifier-required>false</qualifier-required>
</option>
</options>
<restrictions>
<weight-restriction min="0" max="30000"></weight-restriction>
<dimensional-restrictions>
<length min="0.1" max="150"></length>
<width min="0.1" max="150"></width>
<height min="0.1" max="150"></height>
<length-plus-girth-max>300</length-plus-girth-max>
<oversize-limit>100</oversize-limit>
</dimensional-restrictions>
<density-factor>6000</density-factor>
<can-ship-in-mailing-tube>true</can-ship-in-mailing-tube>
<can-ship-unpackaged>false</can-ship-unpackaged>
<allowed-as-return-service>false</allowed-as-return-service>
</restrictions>
</service>`;

/** getoption.jsf - Sample response. */
export const OPTION_RESPONSE = `<option>
<option-code>SO</option-code>
<option-name>Signature option</option-name>
<option-class>FEAT</option-class>
<prints-on-label>true</prints-on-label>
<qualifier-required>false</qualifier-required>
<conflicting-options><option-code>LAD</option-code></conflicting-options>
<prerequisite-options><option-code>DC</option-code><option-code>XX</option-code></prerequisite-options>
</option>`;

/** createshipment.jsf (non-contract) - Sample response. */
export const NC_CREATE_RESPONSE = `<non-contract-shipment-info>
<shipment-id>406951321983787352</shipment-id>
<tracking-pin>123456789012</tracking-pin>
<links>
<link rel="self" href="${HOST}/rs/1234567/ncshipment/406951321983787352" media-type="application/vnd.cpc.ncshipment-v4+xml"></link>
<link rel="details" href="${HOST}/rs/1234567/ncshipment/406951321983787352/details" media-type="application/vnd.cpc.ncshipment-v4+xml"></link>
<link rel="receipt" href="${HOST}/rs/1234567/ncshipment/406951321983787352/receipt" media-type="application/vnd.cpc.ncshipment-v4+xml"></link>
<link rel="refund" href="${HOST}/rs/1234567/ncshipment/406951321983787352/refund" media-type="application/vnd.cpc.ncshipment-v4+xml"></link>
<link rel="label" href="${HOST}/rs/artifact/76108cb5192002d5/10238/0" media-type="application/pdf" index="0"></link>
</links>
</non-contract-shipment-info>`;

/** shipmentdetails.jsf (non-contract) - Sample response. */
export const NC_DETAILS_RESPONSE = `<non-contract-shipment-details>
<final-shipping-point>H0H0H0</final-shipping-point>
<tracking-pin>123456789012</tracking-pin>
<delivery-spec>
<service-code>DOM.EP</service-code>
<sender>
<company>Example Sender Inc.</company>
<contact-phone>555-555-5555</contact-phone>
<address-details>
<address-line-1>100 Example Street</address-line-1>
<city>Exampleville</city>
<prov-state>ON</prov-state>
<postal-zip-code>A1A1A1</postal-zip-code>
</address-details>
</sender>
<destination>
<name>Jane Example</name>
<company>Consumer</company>
<address-details>
<address-line-1>200 Sample Avenue</address-line-1>
<city>Sampletown</city>
<prov-state>ON</prov-state>
<country-code>CA</country-code>
<postal-zip-code>B2B2B2</postal-zip-code>
</address-details>
</destination>
<options><option><option-code>DC</option-code></option></options>
<parcel-characteristics>
<weight>15.000</weight>
<dimensions><length>1</length><width>1</width><height>1</height></dimensions>
<document>false</document>
<unpackaged>false</unpackaged>
<mailing-tube>false</mailing-tube>
</parcel-characteristics>
<preferences>
<show-packing-instructions>true</show-packing-instructions>
<show-postage-rate>false</show-postage-rate>
<show-insured-value>false</show-insured-value>
</preferences>
</delivery-spec>
</non-contract-shipment-details>`;

/** shipmentreceipt.jsf (non-contract) - Sample response. */
export const NC_RECEIPT_RESPONSE = `<non-contract-shipment-receipt>
<final-shipping-point>H0H0H0</final-shipping-point>
<shipping-point-name>EXAMPLE PO</shipping-point-name>
<shipping-point-id>0192</shipping-point-id>
<mailed-by-customer>0001234567</mailed-by-customer>
<service-code>DOM.EP</service-code>
<rated-weight>15.000</rated-weight>
<base-amount>18.10</base-amount>
<pre-tax-amount>19.46</pre-tax-amount>
<gst-amount>0.00</gst-amount>
<pst-amount>0.00</pst-amount>
<hst-amount>2.53</hst-amount>
<priced-options><priced-option><option-code>DC</option-code><option-price>0</option-price></priced-option></priced-options>
<adjustments><adjustment><adjustment-code>FUELSC</adjustment-code><adjustment-amount>1.36</adjustment-amount></adjustment></adjustments>
<cc-receipt-details>
<merchant-name>Canada Post Corporation</merchant-name>
<merchant-url>www.canadapost.ca</merchant-url>
<name-on-card>Jane Example</name-on-card>
<auth-code>000000</auth-code>
<auth-timestamp>2012-03-13T08:27:20-05:00</auth-timestamp>
<card-type>VIS</card-type>
<charge-amount>21.99</charge-amount>
<currency>CAD</currency>
<transaction-type>Sale</transaction-type>
</cc-receipt-details>
<service-standard>
<am-delivery>false</am-delivery>
<guaranteed-delivery>true</guaranteed-delivery>
<expected-transit-time>1</expected-transit-time>
<expected-delivery-date>2012-03-14</expected-delivery-date>
</service-standard>
</non-contract-shipment-receipt>`;

/** onestepshipments.jsf - Sample response. */
export const NC_LIST_RESPONSE = `<non-contract-shipments>
<link rel="shipment" href="${HOST}/rs/1234567/ncshipment/406951321983787352" media-type="application/vnd.cpc.ncshipment-v4+xml"></link>
</non-contract-shipments>`;

/** onestepshipments.jsf - "no shipments found" is an empty structure with HTTP 200. */
export const NC_LIST_EMPTY = "<non-contract-shipments/>";

/** shipmentrefund.jsf (non-contract) - Sample response. */
export const NC_REFUND_RESPONSE = `<non-contract-shipment-refund-request-info>
<service-ticket-date>2015-10-28</service-ticket-date>
<service-ticket-id>GT12345678RT</service-ticket-id>
</non-contract-shipment-refund-request-info>`;

/** shippingmanifest/createshipment.jsf - Sample response. */
export const SHIPMENT_CREATE_RESPONSE = `<shipment-info>
<customer-request-id>order-1001</customer-request-id>
<shipment-id>347881315405043891</shipment-id>
<shipment-status>created</shipment-status>
<tracking-pin>123456789012</tracking-pin>
<links>
<link rel="self" href="${HOST}/rs/1234567/1234567/shipment/347881315405043891" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="details" href="${HOST}/rs/1234567/1234567/shipment/347881315405043891/details" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="group" href="${HOST}/rs/1234567/1234567/shipment?groupid=grp1" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="price" href="${HOST}/rs/1234567/1234567/shipment/347881315405043891/price" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="label" href="${HOST}/rs/artifact/11111111/5555555/0" media-type="application/pdf" index="0"></link>
</links>
</shipment-info>`;

/** A no-manifest create response that embeds the price and credit card receipt. */
export const SHIPMENT_CREATE_TRANSMITTED = `<shipment-info>
<shipment-id>347881315405043892</shipment-id>
<shipment-status>transmitted</shipment-status>
<tracking-pin>123456789012</tracking-pin>
<po-number>P123456789</po-number>
<shipment-price>
<service-code>DOM.EP</service-code>
<base-amount>9.19</base-amount>
<due-amount>10.21</due-amount>
<pre-tax-amount>9.19</pre-tax-amount>
<gst-amount>0.00</gst-amount>
<pst-amount>0</pst-amount>
<hst-amount>1.02</hst-amount>
<service-standard><am-delivery>false</am-delivery><guaranteed-delivery>true</guaranteed-delivery><expected-transmit-time>2</expected-transmit-time><expected-delivery-date>2011-10-07</expected-delivery-date></service-standard>
<rated-weight>10.000</rated-weight>
</shipment-price>
<shipment-receipt>
<cc-receipt-details>
<merchant-name>Canada Post</merchant-name>
<auth-code>AA1111</auth-code>
<auth-timestamp>2013-06-17T08:27:20-05:00</auth-timestamp>
<card-type>VIS</card-type>
<charge-amount>10.21</charge-amount>
<currency>CAD</currency>
<transaction-type>Sale</transaction-type>
</cc-receipt-details>
</shipment-receipt>
<links>
<link rel="self" href="${HOST}/rs/1234567/1234567/shipment/347881315405043892" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="refund" href="${HOST}/rs/1234567/1234567/shipment/347881315405043892/refund" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="label" href="${HOST}/rs/artifact/22222222/6666666/0" media-type="application/zpl" index="0"></link>
</links>
</shipment-info>`;

/** shipmentdetails.jsf (contract) - Sample response. */
export const SHIPMENT_DETAILS_RESPONSE = `<shipment-details>
<shipment-status>reconciled</shipment-status>
<final-shipping-point>H0H0H0</final-shipping-point>
<shipping-point-id>0015</shipping-point-id>
<tracking-pin>123456789012</tracking-pin>
<shipment-detail>
<group-id>grp1</group-id>
<requested-shipping-point>H0H0H0</requested-shipping-point>
<expected-mailing-date>2011-09-01</expected-mailing-date>
<delivery-spec>
<service-code>DOM.EP</service-code>
<sender><name>Sam Sender</name><company>Example Co</company><address-details><address-line-1>100 Example Street</address-line-1><city>Exampleville</city><prov-state>QC</prov-state><country-code>CA</country-code><postal-zip-code>A1A1A1</postal-zip-code></address-details></sender>
<destination><name>Jane Example</name><company>Example Co</company><address-details><address-line-1>200 Sample Avenue</address-line-1><city>Sampletown</city><prov-state>ON</prov-state><country-code>CA</country-code><postal-zip-code>B2B2B2</postal-zip-code></address-details></destination>
<options><option><option-code>DC</option-code></option></options>
<parcel-characteristics><weight>20.000</weight><dimensions><length>12</length><width>9</width><height>6</height></dimensions><unpackaged>true</unpackaged><mailing-tube>false</mailing-tube><oversized>false</oversized></parcel-characteristics>
<notification><email>buyer@example.com</email><on-shipment>true</on-shipment><on-exception>false</on-exception><on-delivery>true</on-delivery></notification>
<print-preferences><output-format>8.5x11</output-format></print-preferences>
<preferences><show-packing-instructions>true</show-packing-instructions><show-postage-rate>false</show-postage-rate><show-insured-value>true</show-insured-value></preferences>
<settlement-info><paid-by-customer>0001234567</paid-by-customer><contract-id>0012345678</contract-id><intended-method-of-payment>Account</intended-method-of-payment></settlement-info>
</delivery-spec>
</shipment-detail>
</shipment-details>`;

/** shipmentprice.jsf - Sample response (with the documented expected-transmit-time typo). */
export const SHIPMENT_PRICE_RESPONSE = `<shipment-price>
<service-code>DOM.EP</service-code>
<base-amount>9.19</base-amount>
<priced-options>
<priced-option><option-code>DC</option-code><option-price>0</option-price></priced-option>
<priced-option><option-code>UP</option-code><option-price>7.50</option-price></priced-option>
</priced-options>
<adjustments>
<adjustment><adjustment-code>AUTDISC</adjustment-code><adjustment-amount>0.00</adjustment-amount></adjustment>
<adjustment><adjustment-code>FUELSC</adjustment-code><adjustment-amount>0.90</adjustment-amount></adjustment>
</adjustments>
<pre-tax-amount>17.59</pre-tax-amount>
<gst-amount>0.00</gst-amount>
<pst-amount>0</pst-amount>
<hst-amount>2.29</hst-amount>
<due-amount>19.88</due-amount>
<service-standard><am-delivery>false</am-delivery><guaranteed-delivery>true</guaranteed-delivery><expected-transmit-time>2</expected-transmit-time><expected-delivery-date>2011-10-07</expected-delivery-date></service-standard>
<rated-weight>10.000</rated-weight>
</shipment-price>`;

/** shipmentreceipt.jsf (contract) - Sample response. */
export const SHIPMENT_RECEIPT_RESPONSE = `<shipment-receipt>
<cc-receipt-details>
<merchant-name>Canada Post Corporation</merchant-name>
<merchant-url>www.canadapost.ca</merchant-url>
<name-on-card>Jane Example</name-on-card>
<auth-code>000000</auth-code>
<auth-timestamp>2013-06-17T08:27:20-05:00</auth-timestamp>
<card-type>VIS</card-type>
<charge-amount>21.99</charge-amount>
<currency>CAD</currency>
<transaction-type>Sale</transaction-type>
</cc-receipt-details>
</shipment-receipt>`;

/** groups.jsf - Sample response (one group: parsed as an object, not an array). */
export const GROUPS_SINGLE = `<groups>
<group>
<link rel="group" href="${HOST}/rs/1234567/1234567/shipment?groupid=123456" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<group-id>123456</group-id>
</group>
</groups>`;

export const GROUPS_MULTI = `<groups>
<group><link rel="group" href="${HOST}/rs/1234567/1234567/shipment?groupid=a1" media-type="application/vnd.cpc.shipment-v8+xml"></link><group-id>a1</group-id></group>
<group><link rel="group" href="${HOST}/rs/1234567/1234567/shipment?groupid=b2" media-type="application/vnd.cpc.shipment-v8+xml"></link><group-id>b2</group-id></group>
</groups>`;

/** shipments.jsf - Sample response. */
export const SHIPMENTS_RESPONSE = `<shipments>
<link rel="shipment" href="${HOST}/rs/1234567/1234567/shipment/33333333333" media-type="application/vnd.cpc.shipment-v8+xml"></link>
<link rel="shipment" href="${HOST}/rs/1234567/1234567/shipment/44444444" media-type="application/vnd.cpc.shipment-v8+xml"></link>
</shipments>`;

/** transmitshipments.jsf - Sample response. */
export const TRANSMIT_RESPONSE = `<manifests>
<link rel="manifest" href="${HOST}/rs/1234567/1234567/manifest/444444444444" media-type="application/vnd.cpc.manifest-v8+xml"></link>
<link rel="manifest" href="${HOST}/rs/1234567/1234567/manifest/333333333333" media-type="application/vnd.cpc.manifest-v8+xml"></link>
</manifests>`;

/** manifest.jsf - Sample response. */
export const MANIFEST_RESPONSE = `<manifest>
<po-number>P906367941</po-number>
<links>
<link rel="self" href="${HOST}/rs/1234567/1234567/manifest/33333333" media-type="application/vnd.cpc.manifest-v8+xml"></link>
<link rel="artifact" href="${HOST}/rs/artifact/33333333/9999/0" media-type="application/pdf"></link>
<link rel="details" href="${HOST}/rs/1234567/1234567/manifest/33333333/details" media-type="application/vnd.cpc.manifest-v8+xml"></link>
<link rel="manifestShipments" href="${HOST}/rs/1234567/1234567/shipment?manifestId=33333333" media-type="application/vnd.cpc.shipment-v8+xml"></link>
</links>
</manifest>`;

/** manifests.jsf - Sample response. */
export const MANIFESTS_RESPONSE = `<manifests>
<link rel="manifest" href="${HOST}/rs/1234567/1234567/manifest/11111111" media-type="application/vnd.cpc.manifest-v8+xml"></link>
<link rel="manifest" href="${HOST}/rs/1234567/1234567/manifest/22222222" media-type="application/vnd.cpc.manifest-v8+xml"></link>
</manifests>`;

/** manifestdetails.jsf - Sample response. */
export const MANIFEST_DETAILS_RESPONSE = `<manifest-details>
<po-number>D906367941</po-number>
<final-shipping-point>H0H0H0</final-shipping-point>
<shipping-point-name>EXAMPLE T PO</shipping-point-name>
<shipping-point-id>0015</shipping-point-id>
<mailed-by-customer>0001234567</mailed-by-customer>
<mailed-on-behalf-of>0001234567</mailed-on-behalf-of>
<paid-by-customer>0001234567</paid-by-customer>
<manifest-date>2011-09-01</manifest-date>
<manifest-time>16:42 EDT</manifest-time>
<contract-id>0012345678</contract-id>
<method-of-payment>account</method-of-payment>
<manifest-pricing-info>
<base-cost>39.57</base-cost>
<automation-discount>0</automation-discount>
<options-and-surcharges>26.37</options-and-surcharges>
<gst>0.00</gst>
<pst>0</pst>
<hst>8.58</hst>
<total-due-cpc>74.52</total-due-cpc>
</manifest-pricing-info>
<manifest-address><manifest-name>Example Shop</manifest-name><phone-number>555 555 5555</phone-number></manifest-address>
</manifest-details>`;

/** trackingsummary.jsf - Sample PIN response. */
export const TRACKING_SUMMARY_RESPONSE = `<tracking-summary>
<pin-summary>
<pin>123456789012</pin>
<origin-postal-id>K1G</origin-postal-id>
<destination-postal-id>K0J</destination-postal-id>
<destination-province>ON</destination-province>
<service-name>Expedited Parcels</service-name>
<mailed-on-date>2011-04-04</mailed-on-date>
<expected-delivery-date>2011-04-05</expected-delivery-date>
<actual-delivery-date/>
<delivery-option-completed-ind>2</delivery-option-completed-ind>
<event-date-time>20110404:133457</event-date-time>
<event-description>Order information received by Canada Post</event-description>
<attempted-date/>
<customer-ref-1>REF1A</customer-ref-1>
<customer-ref-2>REF1C</customer-ref-2>
<return-pin/>
<event-type>INDUCTION</event-type>
<event-location/>
<signatory-name/>
</pin-summary>
</tracking-summary>`;

/** trackingdetails.jsf - Sample response (events as <occurrence>, per the XSD). */
export const TRACKING_DETAIL_RESPONSE = `<tracking-detail>
<pin>123456789012</pin>
<active-exists>1</active-exists>
<archive-exists></archive-exists>
<changed-expected-date>2011-02-11</changed-expected-date>
<destination-postal-id>B2B2B2</destination-postal-id>
<expected-delivery-date>2011-02-01</expected-delivery-date>
<changed-expected-delivery-reason>Customer addressing error found; attempting to correct</changed-expected-delivery-reason>
<mailed-by-customer-number>0001234567</mailed-by-customer-number>
<mailed-on-behalf-of-customer-number>0008765432</mailed-on-behalf-of-customer-number>
<original-pin></original-pin>
<service-name>Xpresspost</service-name>
<service-name-2>Xpresspost</service-name-2>
<customer-ref-1>955-0398</customer-ref-1>
<customer-ref-2></customer-ref-2>
<return-pin></return-pin>
<signature-image-exists>true</signature-image-exists>
<suppress-signature>false</suppress-signature>
<delivery-options>
<item><delivery-option>CH_SGN_OPTION</delivery-option><delivery-option-description>Signature Required</delivery-option-description></item>
</delivery-options>
<significant-events>
<occurrence>
<event-identifier>1496</event-identifier>
<event-date>2011-02-01</event-date>
<event-time>07:59:52</event-time>
<event-time-zone>EST</event-time-zone>
<event-description>Item successfully delivered</event-description>
<signatory-name></signatory-name>
<event-site>SAMPLETOWN</event-site>
<event-province>QC</event-province>
<event-retail-location-id></event-retail-location-id>
<event-retail-name></event-retail-name>
</occurrence>
<occurrence>
<event-identifier>0174</event-identifier>
<event-date>2011-01-31</event-date>
<event-time>08:27:43</event-time>
<event-time-zone>EST</event-time-zone>
<event-description>Item out for delivery</event-description>
<event-site>SAMPLETOWN</event-site>
<event-province>QC</event-province>
</occurrence>
</significant-events>
</tracking-detail>`;

/** fundamentals.jsf - Sample error response (two messages). */
export const ERROR_TWO_MESSAGES = `<messages>
<message>
<code>7007</code>
<description> The weight value is invalid. The weight of each piece must be less than or equal to 30 kg.</description>
</message>
<message>
<code>1722</code>
<description> The options are invalid for the selected Service. Please change the options or select another service.</description>
</message>
</messages>`;

/** A single-message error (parsed as an object, not an array). */
export const ERROR_ONE_MESSAGE = `<messages xmlns="http://www.canadapost.ca/ws/messages"><message><code>9111</code><description>No services are appropriate for the shipment of the defined parcel.</description></message></messages>`;

/** tracking: "No Pin History" answered with the standard messages structure. */
export const ERROR_NO_PIN_HISTORY = `<messages><message><code>004</code><description>No Pin History</description></message></messages>`;
