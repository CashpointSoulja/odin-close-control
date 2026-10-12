# My public-source research

I am Ayo Ahmed. I researched the public materials below before implementation to choose one credible workflow. I did not access internal systems, investor accounts or customer data. I treat these as public descriptions, not a complete operating manual. All inputs in my concept are fictional.

I retrieved every listed URL with HTTP 200 on 12 October 2026 at approximately 23:51 BST (22:51 UTC). [The manifest](sources-manifest.json) records exact requested/resolved URLs, timestamps, byte counts and SHA-256 hashes of the retrieved responses. I retained concise text extractions and brand screenshots; raw pages remain scratch evidence and no font binaries are distributed. [Extraction hashes](extraction-hashes.json) identify the committed text.

| Source | What I observed | My resulting decision |
|---|---|---|
| [Founding Product Builder, Operations](https://jobs.ashbyhq.com/odin/ed22ab98-e9e7-4563-953c-641367a51d13) | The role says “your product is how Odin operates”, describes “around 50 processes”, names cost per deal and asks for “You build, not buy”. | I demonstrate one end-to-end working workflow; I do not invent a map of 50 private processes or claim company savings. |
| [SPV product](https://www.joinodin.com/products/spv) | Odin describes legal structure, investor onboarding, payments and post-close administration as part of its service. | I focus on the handoff between cash collection and the human closing operation. |
| [Closing guide](https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed) | “Once all funds have been collected for the deal, and we've received notice of closing from the Deal Lead” Financial Operations works on closing, including countersigning and wiring. | I check collection and record a synthetic Deal Lead close request before allowing review. Review prepares a packet; it does not execute closing. |
| [Closing guide](https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed) | The guide “typically estimates 7 working days”, from the Deal Lead pressing close, varying with complexity, final legals and wire arrival. | I display source context, never a guaranteed countdown or a claimed service-level agreement. |
| [Primary-deal drafting guide](https://help.joinodin.com/hc/en-gb/articles/25326486288273-Drafting-a-primary-deal) | Base currency is GBP, EUR or USD; investors normally wire in it. Target close date helps the teams prioritise assistance. | I keep currencies separate, reject ambiguous amounts and sort the queue by target date and blockers. |
| [Primary-deal drafting guide](https://help.joinodin.com/hc/en-gb/articles/25326486288273-Drafting-a-primary-deal) | Fee payer “will impact the capital available to invest when the deal closes”. Draft documents or placeholders may be acceptable at drafting. | I make fee payer explicit with illustrative parameters, separate draft from final legal metadata, and do not invent Odin pricing. |
| [Homepage](https://www.joinodin.com/) and [supplied SVG](https://www.joinodin.com/logo-wordmark.svg?dpl=dpl_6QbMcqFDZdtq2NxaDpM3zKRnhNDj) | Literal eye geometry, warm canvas, ink, lime, pills, large type and rounded dark surfaces. | I preserve the observed feel with a documented system-sans fallback; see [my design guide](../brand/design.md). |

## The exact workflow I chose

I ingest synthetic commitments and settlement events, validate the entire batch, reconcile settled receipts to explicit commitment IDs, explain cash and document blockers, accept an explicit human correction and final synthetic legal metadata, request human review of the current revision, and export a packet bearing that immutable revision hash. I stop before signatures, wires or any real closed-investment claim.

I choose deterministic arithmetic because payment precision is better served by integer minor units, explicit rules and tests. Matching uses declared identifiers rather than inferred names. Human-attested synthetic KYC/legal status is an input, not an automatic regulatory decision.

## What I need Odin's team to confirm

I would confirm actual statuses and ownership, authoritative commitment identifiers, what counts as settled, refund/reversal handling, when a close request can be made, legal document completeness rules, the real fee schedule and payer treatment, and permitted review/export retention. I would observe one operation before claiming a baseline or adding an integration. My illustrative metrics are scenario calculations, not measurements of Odin.

## Extraction limits

The Ashby client application did not render its body in the restricted capture browser. Its official HTML contained the full role in the meta description and structured posting payload; I extracted the relevant exact passages from that response. The closing and drafting extracts came from the official article-body HTML. Homepage/SPV text came from the live rendered body. The screenshots show the public homepage after its entrance treatment; remotely hosted decorative media could be unavailable. I did not contact any company or person.
