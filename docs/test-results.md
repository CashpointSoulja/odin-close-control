# Test results

## SQLite Durable Object continuation

I completed the new backend verification on **13 October 2026 at 01:07 BST** (00:07 UTC). The final command was `node --test --test-reporter=tap tests/*.test.js`, equivalent to the repository's `npm test` script. **61 tests passed, 0 failed:** all 34 unchanged domain checks, all eight API scenarios migrated to real Durable Objects, and 19 additional durable-storage checks. [The exact result](evidence/durable-tests.json) lists every passing case; [the validation manifest](evidence/durable-validation-manifest.json) pins the source hashes and configuration.

I ran the production handlers and SQL adapter in Miniflare/workerd with actual SQLite object databases. Test-only subclasses allow SQL inspection, deterministic clock control and pausing one real SHA-256 call to exercise races. Those hooks are absent from the deployed Worker and public routes. Expiry checks advance or expire test records rather than waiting 24 hours; I do not present them as a day-long live observation.

| Check I executed | Observed result |
| --- | --- |
| Two independent HTTP clients, one cookie and expected revision | Exactly one mutation returned 200 and one returned `409 STALE_REVISION`; the stored revision advanced once and JSON matched the winner. |
| Separate visitor objects | Independent concurrent changes stayed within each object's own SQLite row; a forged identity header could not select the other visitor. |
| Restart persistence | I disposed and recreated Miniflare against the same persistent directory. Actual SQLite file headers, state, audit, approval and the complete exported packet/hash survived unchanged. |
| Invalid CSV and preview mismatch | Every stored business-state byte and revision stayed unchanged; there was no partial import. |
| Async hashing races | Changed revisions rejected held preview, export and duplicate-import attempts; expiry during review approval/export denied access. |
| Human review | An intervening mutation cleared the requested review; stale approval and unapproved exports failed. |
| Expiry and alarms | Expired cookies returned 401 and were cleared; explicit renewal created a distinct identity. Own-object alarms removed expired state/counters and retained live windows. Unknown valid-shaped cookies did not seed a session or retain schema. |
| Persistent rate limits | Request/write and creation limits held across restart; malformed attempts consumed their budgets and expired windows were reclaimed. |
| Real SQL failure | A test-only SQLite trigger aborted the update. The transaction rolled back, exact prior state remained, the response was safe 503, and a later valid retry succeeded after removing that test trigger. |
| Namespace faults and private paths | Simulated returned/thrown storage faults became safe 503 responses. Public test/internal routes were inaccessible. This does not claim a real Free quota was exhausted. |
| Browser workflow | The two-file flow, explicit receipt match, final synthetic legal metadata, review, packet/ledger downloads and reload passed against local Wrangler's new Durable Objects. |
| Browser freshness and accessibility | Stale review and packet attempts returned 409; no stale download occurred. Keyboard dialog checks, empty/loading/error states and desktop/mobile overflow checks passed. |
| Configuration dry run | `npm run deploy:check` passed: 59.97 KiB Worker, 15.93 KiB compressed, 14 assets, only `ODIN_SESSIONS`, `ODIN_RATE_LIMITERS` and `ASSETS`. It did not deploy remotely. |

The [new browser report](evidence/durable-browser/browser-results.json) records no uncaught page errors, console errors or failed API responses in the successful flow. I independently recomputed the revision-6 packet's SHA-256 as `0941745b60462c38ab65f11e5b6373809a8480d920063d7a4984afb002c6a412` and matched the current human approval. The [actual packet](evidence/durable-browser/demo-closing-packet.json) and [ledger](evidence/durable-browser/demo-closing-packet.csv) are synthetic downloads from that session. I inspected the actual [desktop](evidence/durable-browser/desktop-viewport.png), [mobile](evidence/durable-browser/mobile-viewport.png), packet, mobile-dialog and stale-error captures. The financial domain, public product files and original domain-test file remain byte-for-byte unchanged from the preserved baseline.

Authentication has been resolved privately outside this build, according to the deployment instruction. I did not request credentials or inspect account resources. The authenticated operator will handle deployment. I verified published Workers Free support, not actual available account quota; [the deployment audit](deployment-audit.md) records exact classes, migration and handoff checks. During this continuation I did not access, reuse or delete any D1 database. I touched no unrelated project, used no paid service and made no company outreach.

**Final walkthrough delivery remains held.** The historical local recording was decoded and sampled, not watched and listened to in full. It does not satisfy the final requirement. A new recording must show the verified public deployment and receive a complete watch with audio. Previously published local artifact URLs remain historical references; they are not a final submission or current backend demonstration.

## Historical D1 verification

I completed the final browser run on **13 October 2026 at 00:12:46 BST** (23:12:46 UTC on 12 October), against local Wrangler at `http://127.0.0.1:8787` with the actual local D1 session database. [The JSON report](evidence/browser-results.json) records a passing run. This is local application evidence; I have not verified a public full-stack deployment.

I uploaded both supplied CSV files through the UI. The real server rejected exponent-form money without changing the session. The valid preview showed one new receipt and two idempotent events, and I applied the pair atomically. I explicitly assigned Aurora's 2,000 GBP receipt to `DEMO-AURORA-COM-002`, attached the final synthetic legal metadata, requested review, and confirmed the current revision as `DEMO-REVIEWER-01`.

I downloaded revision 6's reviewed packet and ledger. An independent Python SHA-256 calculation over the exact canonical snapshot—including the calculation-rule version and derived reconciliation—matched both the packet hash and the approved hash. The ledger contained the receipt's correct account and `200000` minor-unit amount. Reloading preserved the actual approved server session.

| Check I executed | Observed result |
| --- | --- |
| Core UI workflow and persistence | Passed; no uncaught page errors, console errors or failed API responses. |
| QA run packet hash | `c8163e8bc18723f64e5ee64aafa2417cb574fe09fe1c1e8ff1240d866d0d72ab` independently verified. |
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

The historical local recording runs **151.56 seconds** at **1080 × 1920**, with the complete 1440 × 900 desktop scaled proportionally into the portrait canvas. It shows the real local application, a visible moving cursor, a prominent local-demonstration label, fictional records and synthetic narration. It credits Ayo Ahmed alone.

Media verification consists of complete decoding of both source and portrait streams, visual inspection of **153 timeline samples, 10 full-resolution scenes and 18 transition samples**, and audio signal checks. The final frames show the unassigned receipt before matching, reconciled cash while final legal evidence still blocks review, explicit current-revision approval, both downloads and the persisted reviewed session. Source-to-portrait frame comparisons confirm full-frame retention. There are 38 caption cues and 19 narration/action intervals with no overlap or invalid ranges, no audio clipping, and no multi-second dead air; the longest measured quiet pause is 0.66 seconds. [The media report](evidence/video-review-metadata.json) records the exact inspection scope and hashes.

The [saved example packet](evidence/demo-closing-packet.json) and [cash ledger](evidence/demo-closing-packet.csv) are the actual downloads from the recording's fresh synthetic session. Its revision 6 snapshot hash is `8da179c3b948b4f011bb8705e874b27ba8300bbf0118fd569168c60f5fb42f1e`, independently verified against the [recording manifest](evidence/recording-manifest.json). This is a separate session from the original browser run whose hash appears in the table above; [download provenance](evidence/demo-downloads.json) makes that distinction explicit.

I verified the public repository and MP4 file in fresh signed-out browser contexts. GitHub returned HTTP 200, but its repository file view did not embed a video player. GitHub Pages creation returned `403 Resource not accessible by integration`, and the cloud proxy denied the separate release-asset upload host. I previously published the MP4 and an offline browser-viewer bundle as public repository downloads. Final delivery is now held as described above. Hosted full-stack and browser-player publication remain blocked; no live-deployed walkthrough is claimed.
