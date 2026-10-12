# Jobs to be done

**Ayo Ahmed · independent synthetic concept**

I treat these job statements as hypotheses drawn from Odin's public closing and drafting guides, not as interview findings. My focus is one job: preparing and reviewing a close-readiness handoff.

## Primary job

**When a Deal Lead requests close and the supporting cash and legal records can still change, I need to reconcile the current evidence and identify every blocker, so I can hand Financial Operations a reviewable packet with a clear basis for proceeding.**

| Job | What I built to address it | Evidence of completion |
| --- | --- | --- |
| Know what has arrived and what is still owed. | Separate principal commitments, net settled receipts and fee accounts; retain currency and source-event identity. | The ledger explains each minor-unit balance without an FX assumption. |
| Correct an exception without hiding its origin. | Explicit receipt matching and duplicate exclusion; linked, bounded refunds/reversals; an audit trail. | The original event and the decision remain inspectable. |
| Avoid importing half of a new picture. | A preview for both CSVs, followed by one atomic application bound to the preview and revision. | Invalid or stale input leaves the previous state intact. |
| Know whether legal and request dependencies are present. | Final synthetic legal metadata and human attestations of KYC and the Deal Lead's request. | Missing dependencies appear as blockers; attestation is visibly distinct from performing the underlying work. |
| Review the packet that will actually be exported. | Request and approval tied to the current revision; approved snapshot hash; invalidation on later mutation. | Export succeeds only for the approved current revision. |

## Reviewer's job

**When I receive a readiness review request, I need to inspect the evidence and the exact revision I am approving, so my sign-off cannot be carried forward after the underlying state changes.**

I want the reviewer to see the funding calculation, remaining exceptions, legal metadata and attestations together. I use fictional preparer and reviewer labels in the demo. These labels do not establish production identity, independent authorisation or a real segregation-of-duties policy; those controls need Odin's requirements and a real access model.

## Deal Lead's job

**When I have requested close, I need the operational handoff to distinguish that request from readiness and completed closing, so I can communicate progress accurately to investors.**

The public [closing guide](https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed) places progress communication with the Deal Lead. The prototype records the request and readiness; it does not send messages, promise a completion date or act on the Lead's behalf.

## Forces and boundaries

My hypothesis is that operators value the confidence of an explainable ledger and fewer repeated checks. They may resist a new screen if it duplicates their source systems, adds attestation work or loses the flexibility needed for exceptions. I would test both effects, including the cost of maintaining this system.

I prioritise exact reconciliation, visible blockers and a current review over reminders, forecasting, investor messaging and support for unrelated operational processes. I use Aurora Works to demonstrate a funding/legal gap, Harbour Studio to demonstrate ambiguous and adjusted cash, and Cedar Systems to demonstrate a clean synthetic path. Their names and records are fictional; they are not customer cases.

I would consider this job solved in production only when operators can complete a representative handoff with fewer repeat checks, reviewers can explain their decisions, and control failures do not increase. A functioning demo alone does not establish those outcomes.
