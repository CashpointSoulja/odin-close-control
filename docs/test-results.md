# Test results

I completed the final browser run on **12 October 2026 at 23:12:46 UTC**, against local Wrangler at `http://127.0.0.1:8787` with the actual local D1 session database. [The JSON report](evidence/browser-results.json) records a passing run. This is local application evidence; I have not verified a public full-stack deployment.

I uploaded both supplied CSV files through the UI. The real server rejected exponent-form money without changing the session. The valid preview showed one new receipt and two idempotent events, and I applied the pair atomically. I explicitly assigned Aurora's 2,000 GBP receipt to `DEMO-AURORA-COM-002`, attached the final synthetic legal metadata, requested review, and confirmed the current revision as `DEMO-REVIEWER-01`.

I downloaded revision 6's reviewed packet and ledger. An independent Python SHA-256 calculation over the exact canonical snapshot—including the calculation-rule version and derived reconciliation—matched both the packet hash and the approved hash. The ledger contained the receipt's correct account and `200000` minor-unit amount. Reloading preserved the actual approved server session.

| Check I executed | Observed result |
| --- | --- |
| Core UI workflow and persistence | Passed; no uncaught page errors, console errors or failed API responses. |
| Current packet hash | `c8163e8bc18723f64e5ee64aafa2417cb574fe09fe1c1e8ff1240d866d0d72ab` independently verified. |
| Stale human review | A second real client changed the open review's session; approval returned 409, the UI refreshed and cleared the checkbox. |
| Stale packet modal | A second real client changed the approved session; download returned 409, no download occurred, cached JSON was cleared and export controls were disabled. |
| Keyboard | First Tab reached the skip link; 16 Tab steps stayed inside desktop and mobile dialogs; Escape closed the dialog and restored the opener's focus. |
| Responsive layout | No document-level horizontal overflow at 1440 × 1000 or 390 × 844. I inspected the actual desktop, mobile and modal screenshots. |
| Empty state | A real search with no matching deal showed a no-results state; clearing the filter restored the queue. |
| Loading and unavailable-service states | I held one session request before letting the actual server complete it, and separately induced a labelled 503 response. These are deliberate test conditions, not observed outages. |
| Domain and Worker/D1 tests | **42 passed, 0 failed:** 34 domain checks and 8 API checks. [Sanitized result](evidence/automated-tests.json). |
| Static response policy | The final API tests verify static and API security headers; the local server also returned the expected CSP on static content. |

The domain and API checks include strict exact money, accumulated bounds, atomic invalid-input rejection, idempotent/conflicting replay, linked adjustment limits, separate fee obligations, stale revisions, session isolation, export approval checks and CSV formula/quote/newline escaping. UI defects found during verification were corrected: invalid imports now always obtain the authoritative server preview, stale modal downloads revalidate the server revision, the cash progress element complies with the CSP, and arrow icons use supported SVG assets.

The browser run's automation offsets are available in its JSON report. They include scripted actions and screenshot/network overhead; they are not measured human task-completion times or evidence of operational savings. The local new-session rate limit also correctly rejected repeated QA session creation; I cleared only local test counters before the final clean run.

The walkthrough capture is being produced from the real local application, with a prominent local-demonstration label, fictional records and synthetic narration. I will add its actual media inspection results after rendering and verification finish.
