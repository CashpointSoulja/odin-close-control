# Odin Close Control — product requirements

**Ayo Ahmed · independent candidacy concept · 12 October 2026**

I built Close Control to demonstrate how I would approach Odin's **Founding Product Builder, Operations** role: take one operational job apart, make its rules explicit, and build a small system that can be inspected. Every deal, investor, payment, document and operator in this prototype is fictional. This is an independent concept, not an Odin product or a representation of its internal systems.

## The job I chose

Odin's [closing guide](https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed) says Financial Operations starts closing after funds have been collected and the Deal Lead has requested close. Closing includes investment-document countersigning and wiring the final investment amount. Its typical estimate is **seven working days from the Deal Lead pressing close**; deal complexity, receipt of final legals and transfer arrival can change that estimate.

I chose the preparation of a trustworthy close-readiness packet before that human closing work. The [drafting guide](https://help.joinodin.com/hc/en-gb/articles/25326486288273-Drafting-a-primary-deal) permits an initial draft or placeholder agreement and says receiving the final agreement late delays completion. It also says the fee payer affects the capital available to invest. These are public reasons to reconcile cash, fee obligations and document readiness together.

My hypothesis is that an explicit, current readiness record could reduce repeated checks and avoid premature handoffs. I have no access to Odin's actual exception frequency, spreadsheets, handling time or approval policy, so I do not present this as a diagnosis of its operations.

## Users and boundary

| User | Job in this concept |
| --- | --- |
| Deal Operations preparer | Import synthetic records, reconcile exceptions, record human attestations and prepare a review. |
| Human reviewer | Inspect the current record, confirm the requested revision and approve a readiness packet. |
| Deal Lead | Supply a close request; the prototype records a synthetic attestation of that request. |

The output is an **approved readiness packet**, never an assertion that an investment has closed. I do not automate KYC/AML decisions, legal interpretation, signatures, wire initiation or confirmation of receipt by the investee company.

## Smallest useful workflow

1. Open a private demo session containing three fictional deals: Aurora Works in GBP, Harbour Studio in EUR and Cedar Systems in USD.
2. Upload commitment and payment CSVs together. Preview validation, accepted changes and unresolved records before applying the pair atomically. Invalid input changes nothing; the preview is bound to the current revision and its content hash.
3. Inspect principal and fee obligations separately. Resolve an unassigned receipt with an explicit match; inspect possible duplicate receipts, wrong-currency records and linked adjustments without silently merging them.
4. Record final synthetic legal metadata, human KYC attestation and the Deal Lead's close request. The application records those assertions; it does not perform the underlying checks.
5. Request review, inspect the exact requested current revision, then approve it. Export the approved current snapshot and its ledger.

## Rules I require

- I store money as integer minor-unit strings and calculate with exact integer arithmetic. I reject signs, exponents, grouping, unsupported precision and overflow. I never combine currencies or infer FX.
- I use stable `DEMO-` identifiers. Investor selection is restricted to fictional seeded identities; an unmatched receipt remains unresolved until a human chooses its commitment.
- I treat an exact replay of an event ID as idempotent. A conflicting replay is rejected. Distinct event IDs with the same settlement reference, currency and amount require explicit duplicate review across the session, including across deals; all source records remain auditable.
- I link refunds and reversals to their original settlement, within the same deal and currency. Their cumulative amount cannot exceed that settlement. I never let an adjustment increase funded capital.
- I label every fee **illustrative, not Odin pricing**. The demo uses a fixed amount plus 50 basis points, rounds half up to the minor unit, and allocates investor-paid fees by deterministic largest remainder. Lead-paid fees use a separate cash account.
- I block readiness while there is a funding shortfall, overpayment, unresolved allocation, possible duplicate or wrong-currency event, or a missing required human attestation or final legal record.
- I use conservative session-wide revisions: every successful mutation advances the revision. A change to any deal invalidates previous approvals. Review steps also advance the revision; approval binds the resulting revision and snapshot hash. Export requires the approved current revision. An import containing only exact idempotent replays changes no state and preserves the revision and review.

## Acceptance and validation

I require a clean synthetic path from preview through approved export, and blocked paths for invalid import, unresolved cash and stale review. I also require exact fee/adjustment arithmetic, idempotent replay, conflicting duplicate rejection, concurrent-write conflict handling, session isolation and formula-safe CSV exports. The implementation and test evidence are documented separately; [metrics](metrics.md) distinguishes modelled conditions from observed results.

I would confirm the real definitions of funds collected, final legals, authorised reviewer and close request with Odin before proposing a pilot. I would also confirm which source systems own each record, retention obligations, fee rules, tolerances and whether conservative session-wide invalidation is acceptable. Until then, the prototype's rules are explicit design assumptions.
