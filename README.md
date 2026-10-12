# Odin Close Control

An independent concept by **Ayo Ahmed**. Synthetic data only.

I built a close-readiness and cash-reconciliation workbench for my candidacy for Odin’s Founding Product Builder, Operations role. I chose one public, documented workflow: establish that a primary SPV’s funds and evidence are ready for a human financial-operations handoff.

I provide the [local walkthrough MP4](docs/walkthrough.mp4) and an [offline browser-viewer bundle](docs/odin-close-control-evidence.zip). Public full-stack deployment is blocked by missing Cloudflare authentication; the connected GitHub integration also denied Pages publishing. The video is a local demonstration, not a deployed-app recording.

## Why this problem

[Odin’s live role](https://jobs.ashbyhq.com/odin/ed22ab98-e9e7-4563-953c-641367a51d13) says the product is how Odin operates, describes around 50 processes, and puts cost per deal at the centre of the job. I have not accessed those internal processes. I chose one workflow I could substantiate from [the public closing guide](https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed): collected funds and the Deal Lead’s close request precede human financial-operations closing. Final legals and wires affect timing; the stated estimate is typically seven working days from the lead pressing close, not a guarantee or a countdown in this concept.

## In 30 seconds

I upload two small synthetic CSVs, inspect validation and the exact proposed changes, and import them atomically. The workbench reconciles every commitment against eligible settled receipts, flags ambiguous evidence, and makes the next action visible. I resolve an explicit cash match, upload final synthetic legal metadata, request review, and have a synthetic reviewer confirm the current revision. I can then download a closing packet with its cash ledger, illustrative fees, human signoff and SHA-256 revision hash.

The three fictional deals cover an underpayment and missing legal evidence, duplicate settlement references, a wrong-currency receipt, a bounded reversal, and a clean path. I never sum unlike currencies, infer investor identities, merge duplicate payments silently, or turn a readiness approval into an investment being closed.

## Run the real backend locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run db:migrate
npm test
npm run dev
```

Open `http://127.0.0.1:8787`. I use a Cloudflare Worker and a real local D1 database; browser storage is not the persistence layer. Each visitor receives an isolated synthetic session. The sample CSVs and legal metadata are under [public/samples](public/samples). Reset replaces only the current visitor’s seeded demo state.

## Deployment

The backend is designed for Cloudflare Workers and D1. I require authenticated Cloudflare access before deploying it: create a D1 database named `odin-close-control`, replace the obvious placeholder database ID in [wrangler.jsonc](wrangler.jsonc), apply its remote migration, then deploy. I keep credentials out of this repository. Deployment status and verification evidence are recorded in [actual test results](docs/test-results.md); a runnable local backend is not evidence of a public deployment.

```sh
npx wrangler d1 create odin-close-control
# Set the returned database ID in wrangler.jsonc.
npx wrangler d1 migrations apply odin-close-control --remote
npm run deploy
```

## What I deliberately leave to people

KYC and legal statuses are synthetic human attestations. I do not automate regulatory decisions, verify real documents, execute signatures, wire funds, contact investors, or declare a real investment closed. The fee parameters are explicitly illustrative, not Odin pricing or legal rules. Exact integer minor-unit arithmetic and deterministic validation do the financial work; I claim no production language-model service or live integrations.

I accept only the demo identifier vocabulary and synthetic metadata schema. I provide no name, email, bank-account or actual legal-file input. This is a public demonstration, not a production financial system. I have not accessed internal Odin systems, live investor accounts or customer data. I made no company outreach during this build.

## Evidence and product thinking

- [Public research and source limits](docs/research/official-source-notes.md), [live brand evidence](docs/brand/design.md), and [visual guide](docs/brand/visual-guide.html) were committed before implementation.
- [PRD](docs/prd.md), [5 Whys](docs/5-whys.md), [JTBD](docs/jtbd.md), [metrics](docs/metrics.md), and [role viability](docs/viability.md).
- [Architecture](docs/architecture.md), [data schema](docs/data-schema.md), [decisions](docs/decisions.md), and [threat model](docs/threat-model.md).
- [Test plan](docs/test-plan.md), [actual results](docs/test-results.md), and [v2 roadmap](docs/roadmap.md).

I separate modelled scenario assumptions from measured outcomes. I do not claim verified company savings, finance credentials, company affiliation or achievements from this concept. Odin’s team would need to confirm cash-source authority, settlement semantics, fee rules, legal/KYC evidence policy, reviewer permissions and retention before any production work.
