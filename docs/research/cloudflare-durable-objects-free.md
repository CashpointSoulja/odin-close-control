# Workers Free persistence research

I checked Cloudflare's published Durable Objects documentation on 13 October 2026 at 00:57 BST (12 October at 23:57 UTC). I could not fetch the two documentation web pages through this environment's proxy: it returned HTTP 403. I therefore read the official `cloudflare/cloudflare-docs` published `production` branch, including the pricing table and plan-note partials rendered by those pages. The [source manifest](cloudflare/source-manifest.json) records immutable URLs, byte counts and SHA-256 hashes at published commit `a86e20128f0d8e593e128b242761522af2d34fde`.

The canonical pages are [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/). I checked these rules rather than inferring eligibility from the account's D1 allocation.

| Published rule | Consequence for my design |
| --- | --- |
| Workers Free supports SQLite-backed Durable Objects. | I declare new SQLite classes. I do not use the legacy key-value storage backend. |
| 100,000 Durable Object requests/day, including alarm invocations. | Session traffic, creation limiting and cleanup consume the account's budget; a visitor request is not necessarily one billable object request. |
| 13,000 GB-s of duration/day. | I use request handlers and alarms, without persistent polling, WebSockets or timers holding objects awake. |
| 5 million rows read/day; 100,000 rows written/day. | Rate counters, state changes, cleanup deletes and `setAlarm()` writes consume these shared quotas. These limits are not a promise of capacity for this app. |
| 5 GB of SQLite storage across the Free account. | Odin does not receive a reserved 5 GB allocation. Other projects can exhaust the shared allowance. |
| 100 classes on Free; unlimited objects within applicable limits. | This application requires two available class slots, independent of the ten occupied D1 database slots reported to me. |
| 2 MB maximum SQL row/string/BLOB; 100 KB SQL statement; 100 bound parameters. | I store one bounded JSON session row and small fixed SQL statements with bound values. |
| Exceeding a Free limit causes further operations of that type to fail; daily limits reset at 00:00 UTC. | I fail closed on persistence errors. I do not upgrade, bill overage, substitute browser storage or use eventually consistent KV. |
| Empty SQLite databases and metadata still consume storage; `deleteAll()` removes metadata. | Expiry cleanup is scoped to Odin's own objects. Reads of missing sessions must not create empty schema repeatedly. |

Workers platform limits also apply to the front Worker. I have not inspected account usage, available class slots, actual remaining storage, or authenticated production behavior. Authentication was resolved privately outside this build, according to the deployment instruction. I neither requested nor received credentials. The authenticated operator must confirm the account remains on Workers Free and that its shared quotas permit the deployment. An unavailable quota or class slot is a deployment limitation, not permission to change plans or touch another database.

This research supports a small synthetic demonstration. It does not establish production financial suitability, throughput, availability, operating savings or recovery guarantees.
