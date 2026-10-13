# Deployment audit

The separately supplied audit reports the synthetic application live at **[https://ayo-odin-close-control.ayoahmed-49d.workers.dev/](https://ayo-odin-close-control.ayoahmed-49d.workers.dev/)**. I distinguish that external report from independent public verification in this environment, which remains pending. The [structured external report](evidence/external-deployment-report.json) preserves the supplied facts and the missing evidence fields.

| Deployment field | Externally reported value |
| --- | --- |
| Audited and deployed source | `8a734d804d4c3d59f45c09fe34f3f403a9aead3e` |
| Provider version | `0e12fd95-21b8-47e7-8f86-4913865f3e04` |
| Account | Separate managed Cloudflare Free account; email verified, no card and no paid plan. |
| Persistence | Only the two Odin SQLite Durable Object namespaces. |
| Existing resources | Personal databases and unrelated projects untouched. |
| Availability | Initial SSL handshake issue; HTTPS 200 on the next hourly check. Exact times were not supplied. |

I did not request, transfer, inspect or publish credentials, inspect the account, run that remote deployment or perform any D1 operation here. The originally supplied account's ten D1 slots were occupied; the separate account reported above avoids changing those databases. The source commit and provider version are externally reported identifiers, not a provider-version inspection performed here.

## Exact namespace migration

The existing repository and Worker names remain `odin-close-control` and `ayo-odin-close-control`. [wrangler.jsonc](../wrangler.jsonc) declares these bindings in that Worker:

```json
{
  "durable_objects": {
    "bindings": [
      { "name": "ODIN_SESSIONS", "class_name": "OdinSession" },
      { "name": "ODIN_RATE_LIMITERS", "class_name": "OdinRateLimiter" }
    ]
  },
  "migrations": [
    {
      "tag": "odin-sqlite-v1",
      "new_sqlite_classes": ["OdinSession", "OdinRateLimiter"]
    }
  ]
}
```

The exported classes are in [src/worker.js](../src/worker.js); the minimal synchronous SQL adapter is [src/storage.js](../src/storage.js). The Worker serves its existing `public` assets with `run_worker_first: true`, compatibility date `2026-10-12`, `workers_dev: true` and observability disabled. There is no `d1_databases` entry, remote database ID, renamed class, deleted class, cross-script namespace binding, or KV namespace.

Wrangler applies the class migration during deployment. Each new Odin object initializes its own SQL tables lazily. No separate `wrangler d1` command is required or included. I removed the obsolete D1 migration and local D1 migration script from the current tree; I did not run a deletion against any database. Existing local D1 files, if present from prior verification, are untouched and ignored. This is a fresh synthetic persistence layer, not a transfer of any D1 business records.

## Reproducible local checks

```sh
npm ci
npm test
npm run deploy:check
npm run dev
```

The original handoff required Workers Free, two available Durable Object class slots and remaining shared Free quotas. [My source check](research/cloudflare-durable-objects-free.md) records published rules and limits. I have not independently inspected actual account capacity or exhausted a remote Free quota. The external audit reports successful deployment on Free; it does not replace those separate capacity checks for future deployments.

The authenticated operator command is `npm run deploy`. No secret value belongs in a command transcript, issue, commit, screenshot or evidence file. The local dry run remains only a configuration/bundle check, separate from the reported external deployment.

## Reported public verification

The external audit reports running the [browser workflow](../scripts/browser-qa.py) with `BASE_URL` set to the actual public URL. Upload, preview, atomic import, explicit receipt match, final synthetic legal metadata, human review, reload and downloads passed. The approved revision-6 packet hash was validated, but its exact hash was not supplied; local session hashes are not substituted for it. Stale-review and stale-packet checks rejected stale attempts. The successful flow reported no failures, and actual desktop/mobile pixels were reported inspected and clean. These are reported external outcomes; the raw public browser report, screenshots and downloaded packet were not supplied here.

The external test history is also preserved: the first full run passed **60/61**, with a reported transient Miniflare transport `fetch failed` in a write-guard case; the isolated API rerun then passed **8/8**, and the subsequent full rerun passed **61/61**. The first failed attempt remains part of the record. [The test results](test-results.md) separately retain local verification and its earlier fixture failures.

## Independent public verification and final review pending

The current cloud network proxy rejects CONNECT to `ayo-odin-close-control.ayoahmed-49d.workers.dev` with **403** under its enforced destination policy. The bare `workers.dev` entry does not allow the actual hostname. Exact-host allowlisting is pending; public application checks need no account credentials. [My independent access/source record](evidence/public-build-verification.json) records the failed public request and verifies that the local product files still match the reported deployed source. This access failure does not establish an application or TLS failure and does not contradict the externally reported HTTPS 200.

Once access is available, I can repeat public checks in a fresh signed-out browser: the complete synthetic workflow, current review and packet hashes, stale-operation rejection, visitor isolation, reset boundaries, security headers and desktop/mobile views. I have not yet independently verified those public outcomes or the provider version here. Real financial or personal data must remain excluded.

**Final walkthrough delivery remains held.** A new portrait recording must show the public application with the active content readable and receive a complete, continuous watch and listen. The old local recording, full decoding, still samples, audio signal analysis and unattended playback do not satisfy that requirement. No completed public recording or continuous review is claimed. Historical media links remain references only. I do not claim production financial suitability or outcome savings from this audit.

I prepared [public-only recording and narration sources](walkthrough-public/README.md), including a [downloadable source bundle](walkthrough-public/walkthrough-sources.zip). No new public-app footage exists yet; these sources are not a delivered video.
