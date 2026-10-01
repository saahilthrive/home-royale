# Decisions and open questions (Oppenheimer team)

Source: Malcolm Pogue's answers of 2026-09-30, Saahil's answers of 2026-10-01, and the follow-up email sent
2026-10-01 ("RE: Home Royale Automation – follow-ups + Oppenheimer FE website").

## Decided
| Topic | Decision |
|---|---|
| Document | Sales Order in MYOB. Customer invoices go out of WooCommerce, not MYOB (Home Royale). |
| Trigger and Woo status | New paid Woo orders go to MYOB, and the Woo order is then updated automatically. When a MYOB shipment is confirmed, Woo goes to Completed and sends its invoice. |
| On Hold | Orders arrive On Hold until stock is confirmed (no stock sync yet). |
| SKUs ending in `+` | Always drop the `+`. They come from products restructured as variable products. |
| Kits (`ZAS-TGM`, `ZAS-021479-62`, `AG89906`, `21121479`) | Kits exist in live MYOB. Mapping rules to be set at implementation. They are not in the 2026-04-09 sandbox, so orders containing them can't be tested there. |
| Failed orders | Ignore. |
| Freight | `FR-FS1`, flat rate on orders under $99 (Home Royale data: 340/354 orders under $99 charged, 5/1004 over; $13.20 inc GST). |
| Totals | MYOB must match the Woo total exactly. Woo line totals are ex-GST, so send Woo `price` as `UnitPrice`. |
| Read/Write Woo API key | Saahil creates it. |
| Tracking | No current system. To be built: out of scope for the first version. |
| Stock sync | To be built as one system across all sales channels. Out of scope for this pipeline. |
| Production IP allowlist | Handled with the Microsoft 365 move. |

## Open (asked 2026-10-01)
Home Royale:
1. Do Woo orders 42262, 42278 and 42279 (1–3 Mar 2026) exist in live MYOB, and under which customer? (Was web order entry halted after 3 Feb?)
2. Order reference: plain Woo number collides with 29 existing PO numbers. Can it carry a store prefix (`HR42262`, `FE71700`), or go in a separate field?
3. Which Woo status means "sent to MYOB": a new custom status, or Processing?
4. Discounts: all on MYOB lines (Woo already spreads coupons across lines) instead of `DSCNT1`?
5. Products with no SKU: hold for manual review, or give them SKUs?

oppenheimerfe.com.au:
6. How is a Woo trade account matched to a MYOB customer (account number, ABN, code, name or email)? Who maintains it?
7. Retail/guest buyers: does the site still take them, and where should an unmatched buyer go (`ENWWW2`, review queue, new customer)?
8. Website price or the customer's MYOB price, and which wins?
9. Card at checkout or on account? Should orders from credit-hold or COD customers still be created (On Hold)?
10. Freight: same flat rate under $99 as Home Royale (mostly $12.00 inc GST here)?
11. One SO per web order, with splits and returns left to staff?
12. Same flow as Home Royale (status, tracking, On Hold)? Who invoices trade customers: Woo or MYOB?
13. Orders 65279, 67535 and 71471 each appear on two customers (one being `ENWARR`). Which is right?

## Blocked
- **oppenheimerfe.com.au API access:** the `WC2_*` credentials are set, but SiteGround still serves the captcha to
  `160.79.106.x`. Needs the same allowlist as homeroyale.com.au (`160.79.106.0/24`). Saahil will do this 2026-10-02.
  Then run `npm run check` and `npm run reconcile -- oppenheimerfe --since 2024-01-01`.
