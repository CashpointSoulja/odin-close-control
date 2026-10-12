# Product decisions

**Ayo Ahmed · independent synthetic concept**

I record the decisions that shape Close Control so a reviewer can challenge the assumptions and see when I would revisit them.

| Decision | Why I chose it | When I would revisit it |
| --- | --- | --- |
| One readiness and cash-reconciliation workflow. | Public closing and drafting guides provide enough evidence to define a bounded job. I cannot inspect Odin's internal processes. | Discovery shows a different handoff or a more valuable measured constraint. |
| Three fictional deals and fixed fictional identities. | A clean case and two distinct exception cases make the workflow inspectable without collecting personal or financial data. | An authorised pilot has an approved data model, access policy and test dataset. |
| Money as exact integer minor units. | Binary floating point and implicit display rounding are unsuitable for explaining financial balances. | Never for monetary arithmetic; I may expand explicitly supported currency precision. |
| GBP, EUR and USD seed deals; explicit precision support. | The public drafting guide names those three base currencies. Other precision cases exercise arithmetic rather than assert Odin offers those currencies. | Confirmed product requirements establish additional supported currencies and policies. |
| Illustrative fixed-plus-basis-points fees. | Fee payer is a public dependency of investable capital; a transparent example makes that dependency demonstrable. These are not Odin prices. | Odin supplies the authorised fee schedule, rounding, waivers and fee-payer rules. |
| Lead-paid fees in a separate fee cash account. | Principal and fees have distinct obligations. I do not make a fee payment look like an investment commitment. | The real ledger and funding policy specify the correct account structure. |
| Largest-remainder allocation with stable ID tie-breaks. | Investor-paid shares must sum exactly to the fee. A stable rule makes replay and review deterministic. | Odin's contractual allocation policy requires another explicit exact rule. |
| Import commitments and payments as one previewed atomic change. | Applying one file while rejecting the other could create a misleading intermediate readiness state. | Source systems provide an alternative consistent boundary with equal or better controls. |
| Event-ID replay is idempotent; conflicting replay fails. | Reprocessing the same source event must not change cash or silently overwrite evidence. | The authoritative source specifies a different correction model with versioned provenance. |
| Distinct event IDs with the same settlement reference, currency and amount require explicit duplicate review across the session. | A possible duplicate is not proof of identity, including when records name different deals. I retain both records; a human can explicitly exclude one as a duplicate without deleting it. | An authoritative event key safely establishes identity; I still retain correction history. |
| Unmatched receipts remain unresolved. | Guessing an investor assignment would trade a visible exception for an unverified balance. | An authoritative mapping exists and its reliability is demonstrated. |
| Adjustments are positive amounts linked to an original settlement. | A bounded refund/reversal can be explained without ambiguous signed transactions or double subtraction. | The real ledger's event semantics are confirmed, including chargebacks and corrections. |
| KYC and close request are human attestations; legals are metadata. | This concept records the presence of evidence rather than claiming to perform regulated checks or read legal documents. | Approved production integrations can supply authoritative statuses with clear provenance. |
| Every mutation increments a session-wide revision and invalidates approvals; exact no-op imports preserve them. | Conservative invalidation prevents an old approval surviving a changed packet. It also avoids implying that linked changes across deals are harmless. An exact replay does not change the packet. | Verified dependency boundaries support per-deal revisions and invalidate every affected packet reliably. |
| Review request, approval and export bind the current revision and hash. | A reviewer should approve the state that is exported. Review steps advance the revision; approval records the resulting approved revision. | The real approval policy requires additional signatures, immutable versions or another controlled handoff. |
| Approved readiness is separate from completed closing. | Odin's public closing process includes countersigning and a transfer the concept does not perform. | Never without an authoritative completed-closing event and an explicitly expanded scope. |
| No outcome or savings claims from a synthetic demo. | Successful tests do not establish operator time saved, adoption or real investment completion. | Measured, attributable outcomes are available and their limits can be reported. |

I would revisit these decisions with the Deal Operations and Financial Operations teams before live adoption. In particular, funds-collected definitions, fee policies, legal evidence, reviewer permissions, record retention and exception ownership remain assumptions for Odin to confirm.
