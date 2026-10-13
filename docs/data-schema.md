# Synthetic data schema

I keep monetary arithmetic in integer minor units and retain receipt provenance. Every stored business record is synthetic. Company and investor labels come from fixed fixtures; imported records cannot introduce names, email addresses, bank details or arbitrary legal filenames.

## SQLite Durable Object tables

| Table | Fields | Purpose |
| --- | --- | --- |
| `odin_sessions` | `id`, `state_json`, `revision`, `created_at`, `expires_at` | One row in each `OdinSession` object's own SQLite database. `id` is a SHA-256 cookie-secret digest. JSON state and revision save together inside a synchronous transaction with expected-revision comparison. Timestamps are epoch seconds. |
| `odin_rate_limits` | `key`, `count`, `expires_at` | Request/write counters within the visitor's object; creation counters in separate `OdinRateLimiter` objects selected by hashed ingress IP. Keys include fixed windows. No raw IP or cookie secret is stored. |

The [SQL adapter](../src/storage.js) creates these tables only in Odin's namespaces. It enforces valid JSON, nonnegative revisions, positive counters and session expiry after creation. Each database holds at most one session and a small set of current counters; no expiry index or cross-visitor query is needed. The class migration is `odin-sqlite-v1` with `new_sqlite_classes: ["OdinSession", "OdinRateLimiter"]`, not a D1 SQL migration. I store one bounded synthetic workflow per session rather than presenting this as a production financial ledger schema.

The Worker maps `session:` plus the cookie digest into the `ODIN_SESSIONS` namespace. Creation limiting maps `create:` plus an ingress-IP digest into `ODIN_RATE_LIMITERS`. Public requests cannot choose an object ID or override the Worker-derived session identity. Expired state is rejected and an expired identity is never silently reseeded. Alarms and guarded missing-session cleanup delete only Odin object storage; they cannot address any D1 database or another project's namespace.

## Session JSON

| Collection | Fields |
| --- | --- |
| Root | `revision`, `deals`, `commitments`, `events`, `audit` |
| Deal | `id`, `name`, `company`, `currency`, `targetCloseDate`, `feePayer`, `assignee`, `legal`, `attestations`, `review` |
| Commitment | `id`, `dealId`, `investorId`, fixed fictional `label`, `currency`, `amountMinor` |
| Cash event | `id`, `dealId`, `commitmentId`, `importedCommitmentId`, `currency`, `amountMinor`, `type`, `parentEventId`, `bankReference`, `resolution` |
| Audit | `id`, `revision`, `at`, known synthetic `actor`, `operation`, operation-specific evidence |

`amountMinor` is a canonical unsigned integer string, for example `"200000"` for GBP 2,000.00. `BigInt` calculates balances, sums and fees; values and aggregate totals must remain at or below 9,007,199,254,740,991 minor units. Plain decimal input rejects signs, grouping, exponent notation, excess currency decimals and overflow. Formatting is separate from arithmetic. GBP, EUR and USD use two decimal places; shared currency utilities also cover JPY with zero and KWD with three. The three demo deals and their imports use GBP, EUR and USD.

`commitmentId: null` means an unassigned receipt. `importedCommitmentId` retains the canonical imported account even after explicit matching, so re-importing the original unassigned row remains idempotent. A settlement is positive cash; a refund or reversal contains a positive amount that is subtracted from the settlement account. Adjustments must reference an original settlement in the same deal and currency. They cannot reference another adjustment, exceed the original settlement in aggregate or change the parent account.

`resolution: "duplicate"` excludes one explicitly selected duplicate settlement from cash calculations without deleting it. Different event IDs sharing reference, currency and amount are quarantined together across the session, including across deal IDs, until that decision. A conflicting canonical reuse of an event ID is rejected. Wrong-currency receipts stay visible and block readiness; no exchange-rate conversion is inferred.

## CSV imports

Commitments use these exact headers:

```csv
commitment_id,deal_id,investor_id,currency,amount
```

Payments use these exact headers:

```csv
event_id,deal_id,commitment_id,currency,amount,type,parent_event_id,bank_reference
```

Known deal IDs are `DEMO-AURORA`, `DEMO-HARBOUR` and `DEMO-CEDAR`. Known investor IDs come from the fixed `INVESTORS` map in the shared module, are bound to one deal and derive the fictional display labels. New synthetic commitment IDs use `${dealId}-COM-` followed by exactly three digits. Event/parent IDs use a known deal ID, one of `PAY`, `FEE`, `REF` or `REV`, then exactly three digits. Bank references use `DEMO-BANK-`, one of `A`, `H` or `C`, an optional `F` or `R`, then two or three digits. Arbitrary text identifiers are rejected. Empty payment `commitment_id` is allowed so the receipt can be reviewed and explicitly matched. The lead's fee cash account is the derived `DEMO-{DEAL}-FEE` account, separate from an investment commitment.

The synthetic fee is 250 currency units plus 50 basis points of principal, with variable fees rounded half up to one minor unit. It is an illustrative assumption, not Odin pricing. Investor allocation uses proportional whole minor units, assigning remaining units by largest remainder and then commitment ID for ties. Changing the payer recomputes account obligations and invalidates existing review.

## Legal, attestations and review

The uploaded JSON is metadata for a synthetic final document, not document storage or signature verification:

```json
{
  "demo": true,
  "deal_id": "DEMO-AURORA",
  "filename": "DEMO-AURORA-FINAL.pdf",
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "attested_by": "DEMO-OPERATOR-01"
}
```

All five keys are required. The deal, filename and operator must match the known synthetic values. A lowercase SHA-256 digest is recorded as attested metadata; the application does not read or independently verify a PDF. Stored legal metadata adds its final status and upload timestamp.

The `kyc` and `leadRequest` attestations record a boolean, the known synthetic operator, timestamp and synthetic-only evidence note. They are reversible human statements. They do not run KYC or establish an actual closing instruction.

A requested review records `requestedRevision`, `requestedHash`, `requestedBy` and `requestedAt`. Approval adds `approvedRevision`, `approvedHash`, `reviewer` and `approvedAt`. The fictional reviewer is `DEMO-REVIEWER-01`. The snapshot hash includes the revision, deal data excluding review, ordered commitments/events and normalized derived reconciliation with a calculation rule version; it excludes the audit trail. Every later state change conservatively clears review across the session. An exact duplicate import preserves it.

The JSON export includes the reviewed snapshot, reconciliation, audit and synthetic notice. Ledger CSV contains event IDs, account links, currency, integer minor-unit amounts, event types, parent IDs, bank references and duplicate resolutions. All cells are quoted and spreadsheet-formula-leading content is prefixed with an apostrophe.
