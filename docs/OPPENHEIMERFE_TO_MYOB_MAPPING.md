# WooCommerce (oppenheimerfe.com.au) → MYOB: how web orders are recorded today

Store 2: Oppenheimer Food Equipment, WooCommerce on SiteGround. Findings from the MYOB sandbox (a copy of production
as at 2026-04-09), read on 2026-10-01. Nothing was written to MYOB.

**Status: half done.** The MYOB side is analysed below. The WooCommerce side has not been read, because the store's
API isn't reachable yet (see *Access*). So **no Woo-side coverage, SKU match rates or unmapped items yet**, and the
statement that the order series below belongs to this store is an inference from MYOB alone. Run
`npm run reconcile -- oppenheimerfe --since 2024-01-01` once access works; it produces every missing number in one go.

## Access (blocking)
| Check | Result |
|---|---|
| Woo REST API from this environment | **Blocked.** Every request, including `/wp-json/`, `robots.txt` and the homepage, gets SiteGround's Anti-Bot captcha (redirect to `/.well-known/sgcaptcha/`). Same block homeroyale.com.au had. |
| Woo credentials | `WC2_*` secrets set (2026-10-01). Still captcha-blocked from `160.79.106.131`, so the allowlist isn't applied to this site yet. |
| MYOB | OK: 1,070 customers, 4,717 stock items visible. |

To unblock:
1. Ask SiteGround to allowlist `160.79.106.0/24` for **oppenheimerfe.com.au** (the allowlist for homeroyale.com.au does not carry over).
2. Create a **Read** REST API key (WooCommerce → Settings → Advanced → REST API) and add the `WC2_*` environment secrets. Secrets load only when a session starts, so start a new session.
3. `npm run check`, then `npm run reconcile -- oppenheimerfe --since 2024-01-01`.

If an order export is easier, the reconciliation needs one row per line item with: order number, status, date,
customer user ID, billing first name and company, shipping total, discount total, SKU, product name, quantity, line total.

## Where this store's orders live in MYOB
Unlike Home Royale, **orders are booked to each trade customer's own account**, not to one web customer.

- **Order series:** `CustomerOrder` = buyer first name + a 5-digit order number in the range **64808 to 71623**
  (2024-01 to 2026-02). The numbers rise with the date. Home Royale's numbers are in a different range (about 26900 to 42200).
- **Customers:** 82 accounts. 81 are trade customers, all in equipment classes (`NSW EQUIPT`, `VIC EQUIPT`,
  `QLD EQUIP`, `WA EQUIPT`, `SA EQUIPT`). The busiest are `ENKITC` (105 orders), `ENHOUC`, `ENECZA`, `EVHOM4`,
  `EQEDGE`, `ENCASH` and `EVCHE6`. 29 accounts have a single web order; 19 have five or more.
- **Retail / non-account buyers:** `ENWWW2` "Internet Sales-Earth Bound EQUIPMENT", 50 orders, median $53, many of
  them Earth Bound plant-based packs (`EB-*` non-stock). It was **last used 2025-05-17**; nothing since. `INWWW1`,
  `ENWWW3` and `ENWWWW` have no orders.
- **Web share of trade business:** of 871 SOs on these trade accounts since 2025-01, 322 (37%) carry a web reference.
  The rest come in some other way (rep, email, PO).
- **Document:** `SO` Sales Order. Statuses: 427 Completed, 55 Back Order, 13 Canceled, 6 Shipping.

## Order references: details that affect dedupe
- **Casing varies:** `Jane67923`, `JANE71600`, `jane65996`. Compare case-insensitively.
- **One Woo order can have several MYOB documents:**
  - **Returns:** 10 `CM` credit memo orders and 3 `RC` orders reuse the original web reference.
  - **Splits and re-entries:** order 71622 has one Back Order SO plus three more created on 2026-03-11.
  
  Dedupe on order number **and** `OrderType = SO`. Don't assume one SO per Woo order.
- **Possible keying errors:** three numbers appear on two different customers, each time once on `ENWARR`:
  65279 (`ENWWW2`/`ENWARR`), 67535 (`ETWARE`/`ENWARR`) and 71471 (`ESSPOG`/`ENWARR`).
- **Bare numbers collide with trade POs.** On Home Royale, 29 Woo order numbers also exist on other customers' POs
  with a different name. Match on name **and** number, never on the number alone, because this store's orders aren't
  confined to one customer.

## Coverage on the MYOB side (first SO per order number)
| Month | Trade accounts | ENWWW2 | Total |
|---|---|---|---|
| 2024-01 to 2024-06 | 71 | 28 | 99 |
| 2024-07 to 2024-12 | 64 | 18 | 82 |
| 2025-01 to 2025-06 | 71 | 4 | 75 |
| 2025-07 | 21 | 0 | 21 |
| 2025-08 | 21 | 0 | 21 |
| 2025-09 | 17 | 0 | 17 |
| 2025-10 | 51 | 0 | 51 |
| 2025-11 | 39 | 0 | 39 |
| 2025-12 | 34 | 0 | 34 |
| 2026-01 | 32 | 0 | 32 |
| 2026-02-01 to 02-02 | 5 | 0 | 5 |
| 2026-02-03 to 2026-04-09 | **0** | 0 | **0** |

**The same cutoff as Home Royale:** the last new web order number (71623) was keyed on 2026-02-02. At the
Oct 2025 to Jan 2026 rate (about 40 a month), roughly 90 orders up to the snapshot, and everything since, are likely
missing. The Woo data will confirm it.

The retail flow (`ENWWW2`) stopped in 2025-05. Either the store went trade-only, or retail orders since then were not
keyed. The Woo data will tell which.

## Line mapping (from the 487 SOs; Woo SKUs not yet compared)
| MYOB line | Count | Notes |
|---|---|---|
| Stock items | 2,622 lines (93%) | 563 distinct items. Mostly BKF (Bar Keepers Friend) cases, Tojiro knives, Cuitisan, F.Dick. ID shapes: `BKF-35020`, `FD-81447-12-2`, `TFC-1080`, `CEC7-FR04`. |
| `FR-FS1` "Freight Foodservice1" | on 148 orders (30%) | Most common amount is $10.909 ex-GST ($12.00 inc), then various carrier amounts. `FR-FS` was used 3 times. |
| `DSCNT1` "Discount 1" | 3 orders | Discounts almost never appear as a line, so trade pricing is in the unit price (or the price class). |
| `EB-*` Earth Bound packs | 55 lines | Non-stock items, on `ENWWW2` orders only. |

Orders average 5.7 lines. The median trade order is $622, against $53 for `ENWWW2`.

## Amounts
Woo's REST API gives line `total` **ex-GST** with `total_tax` separate, and `price` is the unrounded ex-GST unit
price (`prices_include_tax: false`). That is verified on Home Royale; check that this store is set up the same. Send
`price` as the MYOB `UnitPrice` rather than dividing an inc-GST price by 1.1.

## What this means for the pipeline
- The customer can't be a constant. Each order needs a **Woo customer → MYOB `CustomerID` lookup**, plus a rule for
  buyers with no account. `src/stores.js` marks this store `customer.mode: 'account'`.
- Trade customers carry credit terms, price classes and possibly credit holds. An SO created for a customer on hold
  will stop at Credit Hold.
- Back orders are common here (55 of 487), and staff split SOs. The pipeline should create one SO per Woo order and
  leave splitting to MYOB.

## Questions for the finance team
See `docs/QUESTIONS_FOR_TEAM.md` (section C), kept in one list with the Home Royale follow-ups.
