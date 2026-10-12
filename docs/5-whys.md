# Five whys — a readiness record before closing

**Ayo Ahmed · independent synthetic concept**

I start with one question: **why might a deal with money received still require work before it can be handed to Financial Operations for closing?** I separate public evidence from hypotheses, because I have not observed Odin's internal operation or interviewed its team.

| Why | My reasoning | Evidence status |
| --- | --- | --- |
| 1. Why is money received insufficient? | Odin also needs notice of closing from the Deal Lead, and closing includes final legals and the transfer to the investee company. A receipt alone does not establish the whole state. | Stated in the [closing guide](https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed). |
| 2. Why can those dependencies become ready at different times? | The initial investment agreement may be a draft or placeholder; final agreement receipt can delay completion. The fee payer also changes the capital available to invest. | Stated in the [drafting guide](https://help.joinodin.com/hc/en-gb/articles/25326486288273-Drafting-a-primary-deal). |
| 3. Why could an operator need to repeat checks? | If commitments, settled cash, fee obligations and legal status are represented separately, a change in one may invalidate an earlier conclusion in another. | My hypothesis. The public guides do not establish Odin's internal record layout or rework rate. |
| 4. Why could an earlier review become misleading? | A packet without a binding revision can appear approved after a payment adjustment, fee change or new legal record has changed its meaning. | A general control failure I can reproduce with synthetic data; not a reported Odin incident. |
| 5. Why do I choose explicit readiness and revision-bound review? | The smallest intervention is to compute the current constraints, keep unresolved evidence visible and require a human to review that exact state. It makes the handoff inspectable without attempting to perform regulated decisions or banking actions. | My product decision, to validate with Odin. |

My proposed root cause is **an unbound readiness conclusion across changing dependencies**, conditional on those dependencies being checked separately. I would retire this hypothesis if Odin already has one reliable source of truth with equivalent controls, or if discovery shows that another constraint dominates handling effort.

## What I would remove, retain and measure

I would remove a parallel readiness tracker only after the replacement has a confirmed owner, trustworthy inputs, an agreed review policy and a tested fallback. I would retain human responsibility for KYC/AML, legal decisions, signatures and wires. I would not replace an unresolved receipt with a guessed investor match, or turn a target close date into a claim that a deal has closed.

I would measure preparation time, review time, repeat checks, returned handoffs and exception reasons before and during a controlled shadow trial. Those measurements would tell me whether this intervention deserves adoption. The seven-working-day public estimate includes dependencies the prototype does not control, so I would not claim that preparing a packet eliminates that elapsed period.

## Questions that could change my answer

I would ask the team to show one normal readiness handoff and one returned handoff; identify the evidence that proves collected funds and final legals; explain which changes reopen review; and name the source of truth and owner for each item. I would then test whether the proposed controls replace work or merely add another checklist. None of those discovery activities has been carried out for this candidacy concept.
