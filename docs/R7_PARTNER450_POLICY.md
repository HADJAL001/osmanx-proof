# OSMANX PARTNER 450 — commercial and security policy (draft, 2026-11-20)

## What a customer buys

**Not an investment product.** The catalogue contains two *proposed* independently valuable B2B implementations:

| SKU | One-off price | Specified deliverables | Illustrative one-level affiliate commission |
| --- | ---: | --- | ---: |
| `growth_setup_40k` | 40,000 RUB | Needs audit, workspace setup, quote templates, training, handover | 4,000 RUB |
| `enterprise_setup_200k` | 200,000 RUB | Workflow discovery, multi-team setup, client delivery flows, training, acceptance report | 20,000 RUB |

The exact scopes, fulfillment capacity, tax treatment, merchant contracting, customer cancellation/refund terms and service-level guarantees **must be reviewed before accepting real money**. Quotes currently represent *test-only* flows; neither package is represented as a live purchased service. Fulfillment requires admin evidence description plus SHA-256 hash, followed by a separately authenticated client acceptance. Possession of a link or clicking accept is not a qualified electronic signature.

## Transparent marketing and partner participation

Partner registration **is free** and follows the ordinary user registration flow. No purchase, recurring fee, recruitment quota, or requirement to refer two people to earn. Joining a partner program does not grant any investor interest, profit-sharing right, or promise of recovering a purchase price. There is **one** referral tier. Never credit an inviter for a recruit's subsequent invitations. Commission is earned on the first successful, independently priced business service sold to a distinct buyer attributed at registration, and only once per buyer.

The target of **450 accepted sales** is a visual progress goal, **not a payout milestone** and not a cash prize. The marketing math of “450 sales × 20,000 RUB = 9,000,000 RUB” is a conditional scenario, assuming 450 eligible independent enterprise transactions, complete fulfillment, no refunds, and sufficient unit margin. No investment return or earnings guarantee.

## Commission budget, test controls

Commission = minimum of **10% of a paid package** and **35% of pre-commission contribution**. Pre-commission contribution reserves a configurable estimated delivery cost (40k package: 18k RUB; 200k: 100k RUB), 12% tax reserve, and 3% processing reserve. These are assumptions, not audited real costs or legal tax rates. No commissions may be offered on the live platform until the actual margin and legal obligations have been verified. Commissions become *test-eligible* only after a successfully verified test payment, an admin-submitted delivery evidence hash, buyer acceptance, a 14-day cooling period, and no unresolved fraud flags or refunds. **Test-eligible never means cash payable.**

Only `STRIPE_TEST` signed events tied to pre-registered payment intents and a separately authenticated `SANDBOX_NO_REAL_MONEY` simulation can populate test rows. Stripe TEST rejects `livemode=true`, invalid signatures, mismatched currency, unbound intents, collisions, and wrong amounts. Refunds proportionally reverse the simulated liability. Events are idempotent; every paired ledger posting is balanced.

There are no live charges or payouts. Wallet `availableForCashoutCents` is always **zero**. Adding a live payment and payout provider requires a new reviewed integration, verified identity and tax process, refund reconciliation, independent staging, legal approvals, rate-limiting/monitoring, and an explicit production unlock. Do not repurpose the test path for real money.

## User-facing explanations

Always display: “Тестовая программа. Покупка не обязательна для партнёрства. Выплаты в реальные деньги отключены. Доход не гарантирован.” Do not suggest that users are investing or that inviting friends *returns their deposit*. No clones, binary recruitment trees, tiered downlines or higher earnings for recruitment instead of genuine customer transactions.

## Tenant security and data retention

Buyers can view orders for their owned organization, with only the owner able to issue and accept them. Partners see their own commissions without buyer emails or contacts. Admin delivery is a separately privileged operation. The PostgreSQL RLS source uses SELECT-only `proof_app` policies for buyer orders and inviter commissions; sensitive provider tokens, events and financial records have no `proof_app` read grants. The running Node prototype still uses SQLite; these SQL scripts are CI validation only and do not switch the application to PostgreSQL.
