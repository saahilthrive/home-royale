# WooCommerce (homeroyale.com.au) → MYOB: how web orders are recorded today

Findings from reconciling a WooCommerce order export (with line items, Jan 2025 to Sep 2026) against the MYOB
sandbox (a copy of production as at 2026-04-09). Nothing was written to MYOB.

## Where web orders live in MYOB
- **Customer:** `ENWWW1` "Internet Sales-Home Royale" (one customer for all web buyers). `ENWWWW` "Internet Sales-Shopify" is unused.
- **Document:** a `SO` Sales Order, which is shipped and invoiced from there (a matching SalesInvoice exists).
- **External reference:** `CustomerOrder` = buyer first name + Woo order number, e.g. `Mandy35670`. Match on the trailing digits.

## Coverage (Woo orders dated up to the snapshot)
| Period | Woo Completed | In MYOB | Missing |
|---|---|---|---|
| 2025-01-01 to 2026-02-02 | 763 | 727 (95%) | 36 |
| 2026-02-03 to 2026-04-09 | 137 | 0 | **137**: web order entry into MYOB stopped after 2026-02-03 |

Cancelled and refunded Woo orders are mostly not in MYOB (53 of 56 cancelled, 18 of 24 refunded missing).

## Line mapping rules
| Woo | MYOB | Notes |
|---|---|---|
| SKU `CEC7-FR04+` (trailing `+`) | `CEC7-FR04` | 41 SKUs / 16% of lines. Strip the `+`. |
| Exact SKU | same `InventoryID` | 437 SKUs / 78% of lines. |
| Blank SKU (110 lines, e.g. "Gift Set with Purchase") | real item, e.g. `FD-81447-12-2` | Needs a name → InventoryID lookup table. |
| `ZAS-TGM` (133 lines at $0, free gift) | not in MYOB | Decision needed. |
| `ZAS-021479-62`, `AG89906`, `21121479` | not in MYOB | One line each. |
| Order shipping | non-stock `FR-FS1` "Freight Foodservice1" | Added by staff as a line. |
| Coupon / discount | non-stock `DSCNT1` "Discount 1" | |

## Amounts
Correction (2026-10-01, from the REST API): every order since 2025-01 has `prices_include_tax: false`. Line
`total` is **ex-GST**, `total_tax` is separate, and `price` is the unrounded ex-GST unit price (e.g. 72.682). For 20
of 20 orders sampled, sum of line totals + tax + shipping = order total. Use `price` as MYOB `UnitPrice`. MYOB unit
prices are ex-GST to 4 decimals. Of 370 orders compared line by line,
220 totals match to the cent and most of the rest differ by 1-2 cents (rounding).

## Re-running the reconciliation
`npm run reconcile -- homeroyale [--since 2025-01-01]` (read-only, aggregates only). On 2026-10-01 it reproduced the
figures above: 80% of lines exact, 17% after stripping `+`, 98% of mapped lines found on the MYOB order, and the
2026-02 cutoff. It also found 4,788 `failed` Woo orders in 2025-08, probably a card-testing attack. Exclude
`failed` orders from the pipeline.

## API access (WooCommerce REST)
SiteGround's Anti-Bot captcha blocks the API unless the caller's IP is allowlisted. SiteGround has allowlisted
`160.79.106.0/24` (the Claude cloud session egress range) for testing; replace it with the Azure static
outbound IP when the pipeline moves. Node's built-in `fetch` ignores `HTTPS_PROXY` and leaves from a
different, non-allowlisted IP, so run scripts with `NODE_USE_ENV_PROXY=1` (the `npm run` scripts do this).
