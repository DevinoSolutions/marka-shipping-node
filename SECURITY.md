# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/DevinoSolutions/marka-shipping-node/security/advisories/new)
for this repository. Do not open a public issue for a security problem. You will get an
acknowledgement within a few business days.

## Scope and expectations

- Credentials (API username and password, Zonos key) are only sent in request headers to the
  configured Canada Post host and are never logged or included in errors. Reports of any path
  where they leak are in scope and treated as high severity.
- Links returned by Canada Post are only followed on the configured environment host over HTTPS.
- Never include real credentials, customer numbers or shipment data in a report or an issue.
  If you accidentally exposed an API key, rotate it in the Canada Post Developer Program portal.

## Supported versions

Only the latest published minor version receives fixes.
