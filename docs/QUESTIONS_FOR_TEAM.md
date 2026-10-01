# Open questions for the Oppenheimer team (2026-10-01)

These follow up Malcolm's answers of 2026-09-30 ("Home Royale Automation"). Each answer was checked against the
Home Royale Woo orders and the MYOB sandbox (a copy of production as at 2026-04-09). Answers the data supports
aren't repeated here.

## A. Home Royale: answers that don't match the data
1. **Orders missing since 3 Feb.** Answer: probably a sandbox issue. The sandbox is a full copy of production as at
   9 April and does hold orders for other customers after 3 Feb, so a sandbox fault would have to hit web orders only.
   **Can someone look up Woo orders 42262, 42278 and 42279 (1–3 March 2026) in production MYOB** and say whether
   they exist and under which customer?
2. **SKUs ending in "+".** Answer: they "aren't live on the front end". They are: 291 order lines since July 2026
   (e.g. `CEC7-GS09+`, `CEC7-FR06+`), 17% of all lines. **Is dropping the "+" always right?**
3. **Free gift `ZAS-TGM` and SKUs `ZAS-021479-62`, `AG89906`, `21121479`.** Answer: kit items. None is a kit or an
   item in the sandbox (it has 341 kits, e.g. `ZAS-TOGO`). `ZAS-TGM` first appears on 14 June 2026, after the sandbox
   copy. **Were these kits created in production after April?** If so, can the sandbox be refreshed? Otherwise test
   orders containing them will fail.
4. **Failed orders.** Answer: normal declines (network, card, authentication). **4,763 of them came on one day,
   4 August 2025**, against single digits in every other month. That is card testing, not normal declines. Does
   anyone want to act on it, e.g. Stripe Radar rules or a checkout captcha? The pipeline will ignore failed orders
   either way.
5. **Order reference = Woo order number only.** That's possible, but a bare number collides: **29 Woo order numbers
   already exist in MYOB as other customers' PO numbers.** Can the reference carry a store prefix (e.g. `HR42262`,
   and `FE71700` for oppenheimerfe), or can the number go in a dedicated field (`ExternalRef` /
   `UsrExternalOrderOriginal`)?

## B. Home Royale: new questions raised by the answers
6. **Which Woo status triggers the push?** "New" in Woo is either *Pending payment* (unpaid) or *Processing*
   (paid). Proposal: push only paid orders, then mark them in Woo so they aren't sent twice. If *Processing* is the
   trigger, it can't also be the "sent to MYOB" marker. Which status or tag should mark an order as "in MYOB": a
   custom status such as *Sent to MYOB*, or an order note?
7. **Shipment → Woo Completed with tracking.** Where is the tracking number keyed in MYOB (the shipment's package
   tracking number, or another field)? Which carrier(s)? Which Woo tracking plugin should receive it, if any?
8. **Write access to Woo.** Status and tracking updates need a **Read/Write** Woo API key, not the current Read key.
   Who creates it?
9. **Stock sync.** Which direction (MYOB → Woo only?), from which warehouse(s), how often, and is it MYOB *available*
   or *on hand*? Should orders still arrive On Hold once stock sync is live?
10. **Discounts.** Woo spreads every coupon across the order lines, so line-level discounts are always available.
    Proposal: put all discounts on the MYOB line discount and drop `DSCNT1`. Is that acceptable? If not, which coupon
    codes count as "cart" discounts?
11. **Products with no SKU** (duplicates, per the answer). They are rare now (1–9 lines a quarter). Should they be
    held for manual review, or should someone give them SKUs?
12. **Credentials offer.** Login details won't help: the API block is by IP. SiteGround has already allowlisted the
    test range for homeroyale.com.au. The production pipeline will need its fixed outbound IP allowlisted the same way.

## C. oppenheimerfe.com.au (second store)
13. **Access.** Please ask SiteGround to allowlist `160.79.106.0/24` for **oppenheimerfe.com.au**, as was done for
    homeroyale.com.au. Also create a Read (later Read/Write) WooCommerce API key and send it securely. Every request,
    including the homepage, is currently captcha-blocked from the test environment.
14. **Customer mapping.** These web orders are booked to **each trade customer's own MYOB account** (81 accounts,
    e.g. `ENKITC`, `ENHOUC`, `EQEDGE`), not to one web customer. How is a website account matched to a MYOB customer
    today: an account number, ABN or customer code on the Woo account, or by name or email? Who maintains it for new
    trade customers?
15. **Unmatched buyers.** Retail buyers went to `ENWWW2` "Internet Sales-Earth Bound EQUIPMENT" until May 2025, then
    stopped. Does the site still take retail or guest orders? Where should a buyer with no MYOB account go: `ENWWW2`,
    a hold queue, or a new customer?
16. **Pricing.** Should the sales order carry the website price, or should MYOB apply the customer's price class or
    contract price? Which wins if they differ?
17. **Credit and payment.** Do trade web orders pay by card at checkout or go on account? Should orders from
    customers on credit hold or COD still be created (On Hold)?
18. **Freight.** `FR-FS1` is on 30% of these orders, mostly $12.00 inc GST. Is the rule the same as Home Royale's
    (flat rate under $99)?
19. **Back orders and returns.** 55 of 487 web orders are on Back Order, and staff sometimes split one web order into
    several SOs. Returns are raised as CM/RC orders with the same reference. Should the pipeline create one SO and leave
    splits and returns to staff?
20. **Same workflow as Home Royale?** Same status flow, tracking write-back, stock sync and On Hold rule? And does
    this site invoice customers itself, or does MYOB invoice trade customers?
21. **Possible keying errors.** Web orders 65279, 67535 and 71471 are each on two customers, once on `ENWARR`.
    Which customer is correct?
