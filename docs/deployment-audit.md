# Deployment audit and handoff

I prepared this change for separately authenticated deployment on Workers Free. I did not request, transfer, inspect or publish credentials. I did not run a remote deployment or any D1 operation. The supplied account's ten D1 slots are occupied; I preserve those databases and all unrelated projects.

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

## Checks before the external deployment

```sh
npm ci
npm test
npm run deploy:check
npm run dev
```

The authenticated operator should confirm Workers Free, two available Durable Object class slots, and remaining shared Free quotas. [My source check](research/cloudflare-durable-objects-free.md) records current published rules and limits. If unavailable, stop and record the exact provider error. Do not upgrade, delete an existing resource, reuse a D1 database or switch to eventually consistent storage.

The operator can then run `npm run deploy` within the already authenticated environment. No secret value belongs in a command transcript, issue, commit, screenshot or evidence file. The build's dry run is only a configuration/bundle check.

## Public verification still required

After deployment, I would run the same [browser workflow](../scripts/browser-qa.py) with `BASE_URL` set to the actual public URL and `EVIDENCE_DIR` set to a new evidence directory. I would verify fresh signed-out visitors are isolated; conflicting same-revision clients return one success and one conflict; current review and packet hashes agree; mutation invalidates approval; reset affects only its visitor; and security headers and synthetic notices are present. Real financial or personal data must remain excluded.

Final walkthrough delivery remains held. The recording must show that verified public application, retain readable desktop content within its viewing canvas, and be watched and listened to completely. The old local recording, full decoding, still samples and audio signal analysis do not satisfy that requirement. I do not claim production financial suitability or outcome savings from this handoff.
