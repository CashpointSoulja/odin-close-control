# Metrics and evidence

**Ayo Ahmed · independent synthetic concept**

I separate a **modelled scenario**, an **observed prototype result** and a **production outcome**. I have not measured Odin's actual handling time, costs, exception frequency or savings. I have not closed a real investment. I use the prototype to test explicit controls, then propose the measurements needed to establish operational value.

## Baseline versus outcome

| Measure | Modelled baseline | Observed outcome / evidence boundary |
| --- | --- | --- |
| Scenario coverage | Three fictional deals across GBP, EUR and USD, with a funding/legal gap, cash ambiguity/adjustments and a clean path. | Domain tests confirm the three seeded states; the local browser exercises Aurora's complete preparation and review route. |
| Readiness before reconciliation | Aurora requires £50,000 principal but has £48,000 eligible principal receipts, plus missing final legal metadata. Its separate £500 illustrative lead-paid fee is funded. | Importing the unassigned £2,000 receipt does not fund Linden Ventures until an explicit match. Matching and attaching final synthetic legal metadata clear the blockers; requested revision 5 is approved at revision 6 and exported. This is a synthetic transition, not a customer outcome. |
| Import safety | A pair of files represents one proposed state change. Validation failure or a stale revision must apply zero partial changes. | Domain/API tests pass atomic-rejection and stale-write cases. The local browser invalid preview changes nothing; valid preview reports one new event and two idempotent replays before atomic import. |
| Review freshness | An earlier approval is insufficient after any changing session operation, including a change to another deal. An exact no-op replay preserves it. | Domain/API tests pass approval invalidation, replay preservation and current-revision export. The browser packet contains revision 6 and an independently recomputed snapshot hash. A stale review returns `409` and clears confirmation; a stale packet returns `409`, clears cached export data and produces no download. |
| Financial accuracy | Expected values are calculated in integer minor units, per currency, with stated rounding. | Tests pass precision, overflow, one-minor-unit shortfall/overpayment, fee allocation, bounded linked adjustments and duplicate/currency exclusion cases. These are exact expected-integer checks, not display-rounding checks. |
| Cost or time saved | No measured baseline exists. | **Not measured. No savings claim.** |
| Real investments closed | Zero; all records are fictional. | **Zero.** An approved packet does not mean funds were wired or an investment completed. |

The three-deal baseline is a deliberately chosen demonstration, not a sample from Odin's business. Test pass counts measure implemented behavior against those cases; they do not estimate error rates on a live deal population. The test sources and browser report retain the checks and evidence needed to reproduce the synthetic result.

## A worked arithmetic model

My illustrative fee rule is **250 currency units plus 50 basis points of principal, with half-up rounding to the minor unit**. The fixed component is `25000` minor units for the GBP, EUR and USD seed deals. It is not Odin pricing. For a GBP principal of `1000000` minor units (£10,000), the variable component is `5000` (£50), so the total fee is `30000` (£300). If the lead pays, the principal requirement remains £10,000 and a separate fee account requires £300. If investors pay, their combined requirement is £10,300.

For an allocation example independent of the seed data, I allocate a fee of `10001` minor units across weights `1:2:3`. The floor shares are `1666`, `3333`, `5000`, leaving two units. The largest fractional remainders receive one each, yielding **`1667 + 3334 + 5000 = 10001`**. Ties use stable commitment-ID ordering. I compare the sum with the exact total rather than tolerate a missing penny.

For net cash I use settled receipts minus linked refunds and reversals. I never subtract an adjustment twice, count an excluded duplicate, count a wrong-currency receipt toward a commitment or silently allocate an unmatched receipt. I report balances per currency; £1 and €1 do not become a combined financial total.

## What I would measure with Odin

| Metric | Definition and reason |
| --- | --- |
| Hands-on preparation minutes per deal | Sum of active reconciliation and packet-preparation time. This tests the proposed reduction in repeat work. |
| Hands-on review minutes per deal | Review and returned-review time. This detects work merely being moved to a reviewer. |
| Cost per deal | Loaded labour cost for measured handling time, plus attributable services, rework and system operating cost. I would agree the cost boundary with Finance first. |
| Returned handoffs | Reviewed packets returned for missing or incorrect evidence divided by all handoffs. Track the reason, not just the count. |
| Exception age and owner | Time from an exception being detected to explicit resolution, segmented by cause and responsible dependency. |
| Freshness failures | Stale review or export attempts blocked, plus any stale packet discovered downstream. A blocked attempt is a control event, not automatically an operator error. |
| Elapsed closing time | Time from the Deal Lead's close request to confirmed completed closing in the authorised source system, segmented by legals and transfer dependencies. |

I would compare like-for-like deals in a shadow trial, retain medians and distributions, and check control quality before claiming a benefit. Odin's typical seven-working-day closing estimate is public context, not a measured baseline or a speed promise for this concept.

## Observed-results register

I observed **42 tests passing with zero failures** from `npm test`: 34 [domain tests](../tests/domain.test.js) and eight [Worker/D1 API tests](../tests/api.test.js). The [sanitized test report](evidence/automated-tests.json) records the executed result. The local D1 migration applied successfully. A deployment dry run built the approximately 50 KiB Worker and public assets; it did not deploy a service.

The final [browser report](evidence/browser-results.json), captured on 12 October 2026 against local Wrangler and D1, **passed**. The actual two-file flow reached the revision-6 packet, independently checked its SHA-256 snapshot hash and persisted approval across reload. Stale-review and stale-packet regressions returned the expected `409` responses. Keyboard checks and the 1440-pixel desktop and 390-pixel mobile views passed; the core workflow recorded no page exceptions, console errors or failed API responses. Loading and unavailable-service images are labelled induced conditions, not evidence of a deployed service.

Cloudflare authentication was unavailable when rechecked, so **no public backend or production deployment is verified**. Automation timestamps include network, capture and test overhead; they are not measured human operating time or an improvement against a real baseline. Production adoption, user research, economic impact and real financial closing remain unmeasured.
