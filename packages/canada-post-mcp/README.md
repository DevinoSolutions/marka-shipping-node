# @joinmarka/canada-post-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server (stdio) for Canada Post,
built on [`@joinmarka/canada-post`](https://www.npmjs.com/package/@joinmarka/canada-post)'s
REST/OAuth client. It lets an assistant quote, track and look up shipments, save labels, check
whether the account can pay, find post offices and pickups, and, only when you opt in, create
and void shipments, transmit manifests, book pickups and create return labels.

- **Read tools** (20) are always on. They are free and change nothing.
- **Write tools** (8) exist only when you enable them, only work through **preview then apply**,
  and refuse to run against a Production app unless you say so twice.
- **Credentials** come from environment variables only. Nothing is written to stdout (stdout
  belongs to the MCP transport); logs are JSON lines on stderr and never carry a secret.

## Install and configure

```bash
npm install -g @joinmarka/canada-post-mcp   # or run it with npx
```

Credentials are the Client ID and Client Secret of an app created in the
[Canada Post Developer Portal](https://www.canadapost-postescanada.ca/information/app/drc/home),
plus your customer number. Use a **Test** app first: it answers canned stubs, costs nothing and
creates nothing.

### Claude Code

```bash
claude mcp add canada-post \
  --env CANADAPOST_CLIENT_ID=<your-client-id> \
  --env CANADAPOST_CLIENT_SECRET=<your-client-secret> \
  --env CANADAPOST_CUSTOMER_NUMBER=<your-customer-number> \
  -- npx -y @joinmarka/canada-post-mcp
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "canada-post": {
      "command": "npx",
      "args": ["-y", "@joinmarka/canada-post-mcp"],
      "env": {
        "CANADAPOST_CLIENT_ID": "<your-client-id>",
        "CANADAPOST_CLIENT_SECRET": "<your-client-secret>",
        "CANADAPOST_CUSTOMER_NUMBER": "<your-customer-number>"
      }
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "canada-post": {
      "command": "npx",
      "args": ["-y", "@joinmarka/canada-post-mcp"],
      "env": {
        "CANADAPOST_CLIENT_ID": "<your-client-id>",
        "CANADAPOST_CLIENT_SECRET": "<your-client-secret>",
        "CANADAPOST_CUSTOMER_NUMBER": "<your-customer-number>"
      }
    }
  }
}
```

Keep real values out of files you commit: put them in your client's secret store or an
untracked environment file.

## Environment variables

| Variable                                    | Default          | Meaning                                                                               |
| ------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `CANADAPOST_CLIENT_ID`                      | required         | OAuth client id of the Developer Portal app                                           |
| `CANADAPOST_CLIENT_SECRET`                  | required         | OAuth client secret                                                                   |
| `CANADAPOST_CUSTOMER_NUMBER`                | required         | Your Canada Post customer number                                                      |
| `CANADAPOST_APP`                            | `test`           | `test` or `production`, exactly. Declares which kind of app the credentials belong to |
| `CANADAPOST_MCP_ALLOW_WRITES`               | `false`          | `true` registers the preview and apply tools                                          |
| `CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES`    | `false`          | Also required for write tools when `CANADAPOST_APP=production`                        |
| `CANADAPOST_MCP_PREVIEW_TTL_SECONDS`        | `300`            | Lifetime of a preview (30 to 900)                                                     |
| `CANADAPOST_MCP_PREVIEW_HMAC_KEY`           | random per start | At least 32 characters; seals previews. Leave unset unless you run several processes  |
| `CANADAPOST_MCP_OUTPUT_DIR`                 | temp directory   | Absolute path where labels are saved; when set, labels can only be saved inside it    |
| `CANADAPOST_MOBO`, `CANADAPOST_PLATFORM_ID` | unset            | Behalf-of customer number and platform id, if you use them                            |

Booleans must be exactly `true` or `false`; anything else stops the server at startup.

## Tools

Read tools (always registered):

| Tool                                    | What it does                                                    |
| --------------------------------------- | --------------------------------------------------------------- |
| `canadapost_quote`                      | Price a parcel (rating)                                         |
| `canadapost_services_list`              | Services available for a destination country                    |
| `canadapost_service_get`                | Options and restrictions of one service                         |
| `canadapost_option_get`                 | One option code (delivery confirmation, coverage, ...)          |
| `canadapost_track_by_pin`               | Tracking by PIN, summary or full detail                         |
| `canadapost_track_by_dnc`               | Tracking by delivery notice card number                         |
| `canadapost_track_by_reference`         | Tracking by customer reference and mailing-date window          |
| `canadapost_shipment_get`               | Status, PIN and links of a shipment                             |
| `canadapost_shipment_details`           | Delivery spec and state of a shipment                           |
| `canadapost_shipment_price`             | What a shipment cost                                            |
| `canadapost_shipment_receipt`           | Payment receipt of a shipment (never a card number)             |
| `canadapost_shipment_label`             | Saves the label to a file and returns the path, never the bytes |
| `canadapost_shipments_list`             | Find shipments by request id, PIN, group, manifest or date      |
| `canadapost_groups_list`                | Shipment groups                                                 |
| `canadapost_manifests_list`             | Manifests of a date range                                       |
| `canadapost_manifest_get`               | One manifest, optionally with its details                       |
| `canadapost_customer_payment_readiness` | Can the account pay for labels: a summary, never card data      |
| `canadapost_post_offices_find`          | Post offices near a postal code                                 |
| `canadapost_pickup_availability`        | On-demand pickup availability and cut-off at a postal code      |
| `canadapost_pickup_price`               | What an on-demand pickup would cost                             |

Write tools (only with `CANADAPOST_MCP_ALLOW_WRITES=true`, and the extra production flag for a
Production app):

| Tool                                   | What applying it does                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| `canadapost_preview_create_shipment`   | Creates a shipment and its label (buys postage in Production) |
| `canadapost_preview_void_shipment`     | Voids a shipment that has not been transmitted                |
| `canadapost_preview_refund_shipment`   | Requests a refund (opens a Canada Post service ticket)        |
| `canadapost_preview_transmit_manifest` | Transmits the shipments of groups (bills them in Production)  |
| `canadapost_preview_create_pickup`     | Books an on-demand pickup                                     |
| `canadapost_preview_cancel_pickup`     | Cancels an on-demand pickup                                   |
| `canadapost_preview_create_return`     | Creates an authorized return label                            |
| `canadapost_apply`                     | Executes a preview, given only its `confirmToken`             |

## How writes work: preview, then apply

1. A `canadapost_preview_*` tool validates the input, shows the **exact request** that would be
   sent (and a quote or lookup where one exists), and returns a `confirmToken`. Nothing is sent
   to Canada Post that changes anything.
2. The assistant shows you the preview. Only after you agree does it call `canadapost_apply`
   with `{ confirmToken }`.
3. The token is random (256 bits), sealed with an HMAC over the stored request, **single use**
   and short-lived. The request cannot be changed at apply time, a second apply is refused, and
   a preview made by another process (or before a restart) is unknown. A failed apply consumes
   the token too: an ambiguous failure is reported as `indeterminate` with how to check what
   happened, and is never retried automatically.

Every preview says whether applying it may charge (`mayCharge`) and every apply says whether it
did (`charged`, plus a plain notice).

## Test app versus Production app

- With the default `CANADAPOST_APP=test`, before write tools are registered the server calls
  `assertTestApp()` once: two very different quotes must come back byte-identical, which only a
  Test app does. If that fails the server **refuses to start with writes enabled**.
- With `CANADAPOST_APP=production` writes need **both** `CANADAPOST_MCP_ALLOW_WRITES=true` and
  `CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES=true`. Production applies state clearly that real
  postage was charged. Read tools work against either app.
- The Production app is billed. Do not enable production writes on a machine or in a session you
  do not fully control.

## Labels

`canadapost_shipment_label` saves the PDF (or ZPL) to a file and returns `{ path, bytes,
contentType }`. A path you give must be absolute and end in `.pdf` or `.zpl`; with
`CANADAPOST_MCP_OUTPUT_DIR` set it must be inside that directory. An existing file is never
overwritten.

## Library use

The building blocks are exported: `createCanadaPostMcpServer({ config, client? })`,
`loadConfigFromEnv`, `InMemoryPreviewStore`, `connectStdio`. See the
[API documentation](https://github.com/DevinoSolutions/marka-shipping-node).

## License

MIT
