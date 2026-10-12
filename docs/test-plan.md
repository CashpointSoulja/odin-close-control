# Test plan

I verify the synthetic workflow against the real application server and its local D1 database. I use Python Playwright and system Chromium at 1440 × 1000 for desktop checks and 390 × 844 for mobile checks. The scripts accept `BASE_URL` so the same workflow can later be checked against a deployment.

I keep complete-flow requests real. For loading and unavailable-service screenshots, I deliberately delay or fail one network request and label the resulting evidence as an induced test condition. I do not count those images as deployment evidence.

| Area | Check I run | Evidence I retain |
| --- | --- | --- |
| Import | Select both supplied CSV files; show invalid-input errors; preview the exact valid change set; commit both files together. | Error and preview screenshots; server statuses. |
| Reconciliation | Inspect Aurora's cash requirements and explicitly match its unassigned 2,000 GBP receipt to the correct commitment. | Before/after screenshots and action log. |
| Human evidence | Attach final synthetic legal metadata and record any required attestations; request human review. | Current-revision UI screenshots. |
| Review and packet | Explicitly confirm the requested current snapshot as the synthetic reviewer; download the packet and ledger; inspect the revision and hashes. | Download assertions and sanitized packet metadata. |
| Persistence | Reload the actual server-backed session and verify the approved state persists. | Assertion log. |
| Keyboard | Tab to controls; keep focus inside open dialogs; dismiss with Escape; restore focus to the opener. | Focus assertions. |
| Responsive | Check desktop and mobile widths for page overflow, readable controls and usable dialogs. | Actual browser screenshots, inspected visually. |
| States | Exercise no-results filtering, delayed loading and failed loading. | Clearly labelled state screenshots. |
| Browser health | Collect uncaught page exceptions and failed real API responses during the successful flow. | JSON run report. |

Domain and API checks cover exact minor-unit arithmetic, replay/conflict rules, linked refunds/reversals, fee allocation, malformed and oversized payloads, stale revisions, session isolation, origin protection and CSV formula escaping. I cite their actual executed outcomes in the results after the implementation is ready.

I record the walkthrough at 1440 × 900 and embed the entire desktop frame on a 1080 × 1920 portrait canvas, without cropping. The recording script uses a visible cursor, scene timestamps and a free local voice option. Public credit is limited to Ayo Ahmed and the independent synthetic concept. I only call a walkthrough deployed evidence after its source URL is a verified public deployment.
