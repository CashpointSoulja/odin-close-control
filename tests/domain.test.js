import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ACTOR, REVIEWER, MAX_MINOR, LIMITS, createSeedState, parseAmount, formatMoney,
  prepareImport, applyImport, applyMutation, reconcile, queue, revisionHash, packet,
} from '../public/shared/domain.js';

const CH = 'commitment_id,deal_id,investor_id,currency,amount';
const PH = 'event_id,deal_id,commitment_id,currency,amount,type,parent_event_id,bank_reference';
const payments = (...rows) => `${PH}\n${rows.join('\n')}\n`;
const commitments = (...rows) => `${CH}\n${rows.join('\n')}\n`;
const settlement = (id, amount = '1.00', account = '', currency = 'GBP', reference = undefined, deal = 'DEMO-AURORA') =>
  `${id},${deal},${account},${currency},${amount},settlement,,${reference && reference.startsWith("DEMO-BANK-") ? reference : `DEMO-BANK-${deal.slice(5, 6)}${id.slice(-3)}`}`;
const adjustment = (id, parent, amount, type = 'reversal', account = 'DEMO-AURORA-COM-001', currency = 'GBP', deal = 'DEMO-AURORA') =>
  `${id},${deal},${account},${currency},${amount},${type},${parent},DEMO-BANK-${deal.slice(5, 6)}R${id.slice(-3)}`;
const copy = value => JSON.parse(JSON.stringify(value));
const legal = { demo: true, deal_id: 'DEMO-AURORA', filename: 'DEMO-AURORA-FINAL.pdf', sha256: 'd'.repeat(64), attested_by: ACTOR };
const iso = value => assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.endsWith('Z'));
async function loadSamples() {
  return Promise.all(['commitments.csv', 'payments.csv'].map(name => readFile(new URL(`../public/samples/${name}`, import.meta.url), 'utf8')));
}
async function importRows(state, rows, commitmentCsv = CH) {
  const preparation = prepareImport(state, commitmentCsv, payments(...rows));
  assert.equal(preparation.valid, true, JSON.stringify(preparation.errors));
  return applyImport(state, preparation);
}
async function approvedCedar() {
  let state = createSeedState();
  state = await applyMutation(state, 'review/request', { dealId: 'DEMO-CEDAR' });
  return applyMutation(state, 'review/approve', { dealId: 'DEMO-CEDAR', reviewer: REVIEWER, confirmed: true });
}

test('amount parsing preserves exact precision across supported currency exponents', () => {
  assert.equal(parseAmount('90071992547409.91', 'GBP'), MAX_MINOR.toString());
  assert.equal(parseAmount('0.01', 'USD'), '1');
  assert.equal(parseAmount('123', 'JPY'), '123');
  assert.equal(parseAmount('123.456', 'KWD'), '123456');
  assert.equal(parseAmount('1.2', 'EUR'), '120');
  assert.equal(parseAmount('0', 'GBP'), '0');
  assert.equal(formatMoney(MAX_MINOR.toString(), 'GBP'), 'GBP 90,071,992,547,409.91');
  assert.equal(formatMoney('123456', 'KWD'), 'KWD 123.456');
  assert.equal(formatMoney('123', 'JPY'), 'JPY 123');
});

test('rejects malformed, negative, ambiguous, grouped, exponent and overflowing money', () => {
  for (const amount of ['', '-1', '+1', '1e3', '1E3', '1,000', '1 000', ' 1', '1 ', '.1', '1.', 'NaN', 'Infinity', '001', '00.10', '1.001', '90071992547409.92']) {
    assert.throws(() => parseAmount(amount, 'GBP'), { status: 400 }, amount);
  }
  assert.throws(() => parseAmount('1.0', 'JPY'));
  assert.throws(() => parseAmount('1.0001', 'KWD'));
  assert.throws(() => parseAmount(1, 'GBP'));
  for (const currency of ['gbp', 'CHF', 'GBP ', '__proto__']) assert.throws(() => parseAmount('1', currency));
  assert.throws(() => formatMoney(9007199254740991, 'USD'));
  assert.throws(() => formatMoney('-1', 'USD'));
});

test('three seed deals explain exact funding blockers, without treating readiness as closing', () => {
  const state = createSeedState();
  const aurora = reconcile(state, 'DEMO-AURORA');
  assert.equal(aurora.principalMinor, '5000000');
  assert.equal(aurora.eligibleMinor, '4800000');
  assert.equal(aurora.fee.totalMinor, '50000');
  assert.deepEqual(aurora.blockers.map(item => item.code), ['UNDERPAYMENT', 'FINAL_LEGAL_MISSING']);
  const harbour = reconcile(state, 'DEMO-HARBOUR');
  assert.equal(harbour.eligibleMinor, '1400000');
  assert.ok(harbour.blockers.some(item => item.code === 'DUPLICATE_REFERENCE'));
  assert.ok(harbour.blockers.some(item => item.code === 'WRONG_CURRENCY'));
  assert.equal(reconcile(state, 'DEMO-CEDAR').ready, true);
  assert.equal(state.deals.find(item => item.id === 'DEMO-CEDAR').review, null);
  assert.throws(() => reconcile(state, 'DEMO-UNKNOWN'), { code: 'UNKNOWN_DEAL' });
});

test('queue prioritises target date, then severity, then ID and carries source evidence', () => {
  const state = createSeedState(); state.deals.forEach(item => { item.targetCloseDate = '2026-10-14'; });
  const ordered = queue(state);
  assert.deepEqual(ordered.map(item => item.id), ['DEMO-HARBOUR', 'DEMO-AURORA', 'DEMO-CEDAR']);
  assert.ok(ordered[0].severityRank > ordered[1].severityRank);
  assert.equal(ordered[0].assignee, ACTOR);
  assert.ok(ordered[0].evidenceSources.some(item => item.eventIds?.includes('DEMO-HARBOUR-REV-001')));
  assert.ok(ordered[0].evidenceSources.some(item => item.url?.startsWith('https://help.joinodin.com/')));
});

test('sample batch previews explicit additions and imports atomically at one revision', async () => {
  const state = createSeedState(), original = JSON.stringify(state);
  const [cc, pc] = await loadSamples();
  const prep = prepareImport(state, cc, pc);
  assert.equal(prep.valid, true); assert.equal(prep.summary.newEvents, 1); assert.equal(prep.summary.idempotentEvents, 2);
  assert.equal(prep.diff.events[0].after.commitmentId, null);
  assert.equal(JSON.stringify(state), original);
  const next = await applyImport(state, prep);
  assert.equal(next.revision, 2); assert.equal(next.events.length, state.events.length + 1);
  assert.ok(reconcile(next, 'DEMO-AURORA').blockers.some(item => item.code === 'UNASSIGNED_EVENT'));
  assert.equal(next.audit[0].operation, 'import'); iso(next.audit[0].at);
});

test('entire CSV batch rejects atomically, even when an earlier row was valid', async () => {
  const state = createSeedState(), original = JSON.stringify(state);
  const prep = prepareImport(state, CH, payments(settlement('DEMO-AURORA-PAY-101'), settlement('DEMO-AURORA-PAY-102', '-1')));
  assert.equal(prep.valid, false); assert.equal(prep.nextState, undefined);
  assert.equal(prep.errors[0].row, 3); assert.equal(prep.errors[0].source, 'payments');
  assert.equal(JSON.stringify(state), original);
  await assert.rejects(applyImport(state, prep), { code: 'INVALID_IMPORT' });
});

test('CSV parser accepts quoted fields/BOM/CRLF and rejects broken schemas and quoting', () => {
  const state = createSeedState();
  const good = `\uFEFF${PH}\r\n"DEMO-AURORA-PAY-103",DEMO-AURORA,,GBP,1.00,settlement,,DEMO-BANK-A103\r\n`;
  assert.equal(prepareImport(state, CH, good).valid, true);
  for (const bad of [`${PH}\n"DEMO-BROKEN`, `${PH}\n"DEMO-X"x,DEMO-AURORA,,GBP,1,settlement,,DEMO-X`, `${PH}\nDEMO-X,DEMO-AURORA`, `${PH},email\n`, PH.replace('event_id', 'name'), `"${PH}"\n${settlement('DEMO-AURORA-PAY-115')}`]) {
    assert.equal(prepareImport(state, CH, bad).valid, false, bad);
  }
});

test('CSV input uses exact known fictional investors and rejects real or unknown identities', () => {
  const state = createSeedState();
  for (const row of [
    'DEMO-AURORA-COM-003,DEMO-AURORA,REAL-PERSON,GBP,100',
    'DEMO-AURORA-COM-003,DEMO-AURORA,DEMO-INVESTOR-C1,GBP,100',
    'DEMO-HARBOUR-COM-003,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,100',
    'DEMO-AURORA-COM-003,DEMO-AURORA,DEMO-INVESTOR-A3,USD,100',
    'DEMO-AURORA-COM-003,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,0',
  ]) assert.equal(prepareImport(state, commitments(row), PH).valid, false, row);
  assert.equal(prepareImport(state, commitments('DEMO-AURORA-COM-003,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,100'), PH).valid, true);
  assert.equal(prepareImport(state, CH, payments(settlement('REAL-EVENT'))).valid, false);
  assert.equal(prepareImport(state, CH, payments(settlement('DEMO-AURORA-PAY-115', '1', 'DEMO-UNKNOWN'))).valid, false);
});

test('synthetic identifier namespaces reject personal-text suffixes and mismatched deal IDs', () => {
  const state = createSeedState();
  const namedCommitment = prepareImport(state, commitments('DEMO-AURORA-COM-JOHN-SMITH,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,100'), PH);
  assert.equal(namedCommitment.valid, false); assert.equal(namedCommitment.errors[0].code, 'INVALID_SYNTHETIC_ID');
  for (const row of [
    settlement('DEMO-AURORA-PAY-JOHN-SMITH'),
    'DEMO-AURORA-PAY-999,DEMO-AURORA,,GBP,1,settlement,,DEMO-BANK-JOHN-SMITH',
    settlement('DEMO-CEDAR-PAY-999', '1', '', 'GBP', 'DEMO-BANK-A999', 'DEMO-AURORA'),
  ]) {
    const preparation = prepareImport(state, CH, payments(row));
    assert.equal(preparation.valid, false); assert.equal(preparation.errors[0].code, 'INVALID_SYNTHETIC_ID');
  }
});

test('commitment amount updates are supported while existing identity reassignment is rejected', async () => {
  const state = createSeedState();
  const prep = prepareImport(state, commitments('DEMO-AURORA-COM-001,DEMO-AURORA,DEMO-INVESTOR-A1,GBP,30000.01'), PH);
  assert.equal(prep.valid, true); assert.equal(prep.summary.updatedCommitments, 1);
  const next = await applyImport(state, prep);
  assert.equal(next.commitments.find(item => item.id === 'DEMO-AURORA-COM-001').amountMinor, '3000001');
  const conflict = prepareImport(state, commitments('DEMO-AURORA-COM-001,DEMO-AURORA,DEMO-INVESTOR-A2,GBP,30000'), PH);
  assert.equal(conflict.valid, false); assert.equal(conflict.errors[0].code, 'COMMITMENT_CONFLICT');
  assert.equal(prepareImport(state, commitments('DEMO-AURORA-COM-003,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,1', 'DEMO-AURORA-COM-003,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,1'), PH).valid, false);
});

test('stable event IDs are idempotent; changed canonical events are rejected', async () => {
  const state = createSeedState();
  const existing = settlement('DEMO-AURORA-PAY-001', '30000.0', 'DEMO-AURORA-COM-001', 'GBP', 'DEMO-BANK-A001');
  const prep = prepareImport(state, CH, payments(existing, existing));
  assert.equal(prep.valid, true); assert.equal(prep.summary.idempotentEvents, 2); assert.equal(prep.summary.newEvents, 0);
  assert.deepEqual(await applyImport(state, prep), state);
  const conflict = prepareImport(state, CH, payments(existing.replace('30000.0', '30000.01')));
  assert.equal(conflict.valid, false); assert.equal(conflict.errors[0].code, 'EVENT_CONFLICT');
  const withinBatch = prepareImport(state, CH, payments(settlement('DEMO-AURORA-PAY-104', '1'), settlement('DEMO-AURORA-PAY-104', '2')));
  assert.equal(withinBatch.valid, false); assert.equal(withinBatch.errors[0].code, 'EVENT_CONFLICT');
});

test('unassigned receipt retains original canonical identity after explicit matching and reupload', async () => {
  const originalRow = settlement('DEMO-AURORA-PAY-105', '2000.00', '', 'GBP', 'DEMO-AURORA-PAY-105');
  let state = await importRows(createSeedState(), [originalRow]);
  state = await applyMutation(state, 'match', { dealId: 'DEMO-AURORA', eventId: 'DEMO-AURORA-PAY-105', commitmentId: 'DEMO-AURORA-COM-002' });
  assert.equal(reconcile(state, 'DEMO-AURORA').eligibleMinor, '5000000');
  const prep = prepareImport(state, CH, payments(originalRow));
  assert.equal(prep.valid, true); assert.equal(prep.summary.idempotentEvents, 1);
  assert.deepEqual(await applyImport(state, prep), state);
  await assert.rejects(applyMutation(state, 'match', { dealId: 'DEMO-AURORA', eventId: 'DEMO-AURORA-PAY-105', commitmentId: 'DEMO-AURORA-COM-001' }), { code: 'ALREADY_MATCHED' });
});

test('different IDs sharing bank reference+currency+amount stay quarantined until explicit exclusion', async () => {
  const state = createSeedState(); const before = reconcile(state, 'DEMO-HARBOUR');
  const group = before.blockers.find(item => item.code === 'DUPLICATE_REFERENCE');
  assert.deepEqual(group.evidence, ['DEMO-HARBOUR-PAY-001', 'DEMO-HARBOUR-PAY-002']);
  assert.equal(before.accounts[0].settledMinor, '0');
  const next = await applyMutation(state, 'event/resolve', { eventId: 'DEMO-HARBOUR-PAY-002', resolution: 'duplicate' });
  const after = reconcile(next, 'DEMO-HARBOUR');
  assert.equal(after.accounts[0].settledMinor, '2500000');
  assert.equal(after.blockers.some(item => item.code === 'DUPLICATE_REFERENCE'), false);
  assert.equal(next.events.length, state.events.length); assert.equal(next.events.find(item => item.id === 'DEMO-HARBOUR-PAY-002').resolution, 'duplicate');
  assert.equal(next.audit[0].resolution, 'duplicate');
  await assert.rejects(applyMutation(next, 'event/resolve', { eventId: 'DEMO-HARBOUR-PAY-002', resolution: 'duplicate' }), { code: 'ALREADY_RESOLVED' });
  await assert.rejects(applyMutation(state, 'event/resolve', { eventId: 'DEMO-CEDAR-PAY-001', resolution: 'duplicate' }), { code: 'INVALID_RESOLUTION' });
});

test('same reference with different amounts does not create an inferred duplicate', async () => {
  const state = await importRows(createSeedState(), [settlement('DEMO-AURORA-PAY-106', '1', '', 'GBP', 'DEMO-BANK-A901'), settlement('DEMO-AURORA-PAY-107', '2', '', 'GBP', 'DEMO-BANK-A901')]);
  assert.equal(reconcile(state, 'DEMO-AURORA').blockers.some(item => item.code === 'DUPLICATE_REFERENCE'), false);
  assert.equal(reconcile(state, 'DEMO-AURORA').unresolvedEvents.length, 2);
});

test('duplicate reference groups span the synthetic session and block each affected deal', async () => {
  const state = await importRows(createSeedState(), [settlement('DEMO-AURORA-PAY-108', '10000', '', 'USD', 'DEMO-BANK-C001')]);
  const aurora = reconcile(state, 'DEMO-AURORA'), cedar = reconcile(state, 'DEMO-CEDAR');
  assert.ok(aurora.blockers.some(item => item.code === 'DUPLICATE_REFERENCE'));
  assert.ok(cedar.blockers.some(item => item.code === 'DUPLICATE_REFERENCE'));
  assert.equal(cedar.accounts[0].settledMinor, '0');
  assert.equal(cedar.ready, false);
});

test('wrong-currency receipts remain blocked and never convert or fund an account', async () => {
  let state = createSeedState();
  const result = reconcile(state, 'DEMO-HARBOUR');
  assert.equal(result.accounts.find(item => item.id === 'DEMO-HARBOUR-COM-002').settledMinor, '1400000');
  assert.ok(result.unresolvedEvents.some(item => item.id === 'DEMO-HARBOUR-PAY-004'));
  state = await importRows(state, [settlement('DEMO-AURORA-PAY-109', '2000', '', 'USD')]);
  await assert.rejects(applyMutation(state, 'match', { dealId: 'DEMO-AURORA', eventId: 'DEMO-AURORA-PAY-109', commitmentId: 'DEMO-AURORA-COM-002' }), { code: 'WRONG_CURRENCY' });
});

test('refunds and reversals reduce only their linked parent cash account, independent of row order', async () => {
  const state = await importRows(createSeedState(), [
    adjustment('DEMO-AURORA-REF-101', 'DEMO-AURORA-PAY-110', '7', 'refund'),
    settlement('DEMO-AURORA-PAY-110', '10', 'DEMO-AURORA-COM-001'),
    adjustment('DEMO-AURORA-REV-101', 'DEMO-AURORA-PAY-110', '3'),
  ]);
  const result = reconcile(state, 'DEMO-AURORA');
  assert.equal(result.accounts[0].settledMinor, '3000000');
  assert.ok(result.accounts[0].eventIds.includes('DEMO-AURORA-REF-101'));
});

test('adjustments reject missing/adjustment/cross-deal/cross-currency parents and aggregate excess', () => {
  const state = createSeedState();
  const cases = [
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-117', '1')],
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-001', '30000.01')],
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-001', '20000'), adjustment('DEMO-AURORA-PAY-116', 'DEMO-AURORA-PAY-001', '10000.01')],
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-001', '1', 'refund'), adjustment('DEMO-AURORA-PAY-116', 'DEMO-AURORA-PAY-115', '1')],
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-001', '1', 'refund', 'DEMO-AURORA-COM-002')],
    [adjustment('DEMO-HARBOUR-REF-101', 'DEMO-AURORA-PAY-001', '1', 'refund', 'DEMO-HARBOUR-COM-001', 'EUR', 'DEMO-HARBOUR')],
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-001', '1', 'refund', 'DEMO-AURORA-COM-001', 'USD')],
    [adjustment('DEMO-AURORA-PAY-115', 'DEMO-AURORA-PAY-001', '0')],
  ];
  for (const rows of cases) assert.equal(prepareImport(state, CH, payments(...rows)).valid, false, rows.join('\n'));
});

test('parent quarantine also quarantines adjustments and parent with adjustments cannot be excluded', async () => {
  const state = await importRows(createSeedState(), [
    settlement('DEMO-AURORA-PAY-111', '10', 'DEMO-AURORA-COM-001', 'GBP', 'DEMO-BANK-A902'),
    settlement('DEMO-AURORA-PAY-112', '10', 'DEMO-AURORA-COM-001', 'GBP', 'DEMO-BANK-A902'),
    adjustment('DEMO-AURORA-REV-102', 'DEMO-AURORA-PAY-111', '1'),
  ]);
  assert.ok(reconcile(state, 'DEMO-AURORA').blockers.some(item => item.code === 'PARENT_QUARANTINED'));
  await assert.rejects(applyMutation(state, 'event/resolve', { eventId: 'DEMO-AURORA-PAY-111', resolution: 'duplicate' }), { code: 'HAS_ADJUSTMENTS' });
  const next = await applyMutation(state, 'event/resolve', { eventId: 'DEMO-AURORA-PAY-112', resolution: 'duplicate' });
  assert.equal(reconcile(next, 'DEMO-AURORA').accounts[0].settledMinor, '3000900');
});

test('fees use half-up basis points and deterministic largest-remainder investor allocations', async () => {
  let state = createSeedState();
  state.commitments = state.commitments.filter(item => item.dealId !== 'DEMO-AURORA');
  for (let index = 1; index <= 3; index += 1) state.commitments.push({ id: `DEMO-AURORA-COM-00${index}`, dealId: 'DEMO-AURORA', investorId: 'DEMO-INVESTOR-A1', label: 'Fictional', currency: 'GBP', amountMinor: '1' });
  state.events = state.events.filter(item => item.dealId !== 'DEMO-AURORA');
  state = await applyMutation(state, 'fee', { dealId: 'DEMO-AURORA', payer: 'investors' });
  const fee = reconcile(state, 'DEMO-AURORA').fee;
  assert.equal(fee.fixedMinor, '25000'); assert.equal(fee.variableMinor, '0');
  assert.deepEqual(fee.allocations.map(item => item.amountMinor), ['8334', '8333', '8333']);
  assert.equal(fee.allocations.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n), BigInt(fee.totalMinor));
  state.commitments.find(item => item.id === 'DEMO-AURORA-COM-001').amountMinor = '98';
  assert.equal(reconcile(state, 'DEMO-AURORA').fee.variableMinor, '1'); // 100 minor principal, 0.5 rounds up.
});

test('fee payer change moves obligations and exposes seeded lead cash rather than silently reallocating it', async () => {
  const state = await applyMutation(createSeedState(), 'fee', { dealId: 'DEMO-CEDAR', payer: 'investors' });
  const result = reconcile(state, 'DEMO-CEDAR');
  assert.deepEqual(result.fee.allocations.map(item => item.amountMinor), ['17500', '17500']);
  assert.equal(result.accounts.find(item => item.kind === 'fee').overpaymentMinor, '35000');
  assert.equal(result.ready, false);
  assert.equal(result.accounts[0].shortfallMinor, '17500');
});

test('one minor-unit under/overpayment remains a blocker with no tolerance or floating-point drift', async () => {
  const over = await importRows(createSeedState(), [settlement('DEMO-CEDAR-PAY-101', '0.01', 'DEMO-CEDAR-COM-001', 'USD', 'DEMO-CEDAR-PAY-101', 'DEMO-CEDAR')]);
  assert.equal(reconcile(over, 'DEMO-CEDAR').accounts[0].overpaymentMinor, '1');
  const under = await importRows(createSeedState(), [adjustment('DEMO-CEDAR-REF-101', 'DEMO-CEDAR-PAY-001', '0.01', 'refund', 'DEMO-CEDAR-COM-001', 'USD', 'DEMO-CEDAR')]);
  assert.equal(reconcile(under, 'DEMO-CEDAR').accounts[0].shortfallMinor, '1');
});

test('aggregate cash and obligations reject overflow before state is committed', async () => {
  const state = createSeedState();
  const tooLarge = prepareImport(state, CH, payments(settlement('DEMO-CEDAR-PAY-102', '90071992547409.91', 'DEMO-CEDAR-FEE', 'USD', 'DEMO-CEDAR-PAY-102', 'DEMO-CEDAR')));
  assert.equal(tooLarge.valid, false); assert.equal(tooLarge.errors[0].code, 'AMOUNT_OVERFLOW');
  const obligations = prepareImport(state, commitments('DEMO-CEDAR-COM-001,DEMO-CEDAR,DEMO-INVESTOR-C1,USD,90071992537409.91'), PH);
  assert.equal(obligations.valid, false); assert.equal(obligations.errors[0].code, 'AMOUNT_OVERFLOW');
  const unresolved = await importRows(state, [settlement('DEMO-CEDAR-PAY-103', '90071992547409.91', '', 'USD', 'DEMO-CEDAR-PAY-103', 'DEMO-CEDAR')]);
  const unchanged = JSON.stringify(unresolved);
  await assert.rejects(applyMutation(unresolved, 'match', { dealId: 'DEMO-CEDAR', eventId: 'DEMO-CEDAR-PAY-103', commitmentId: 'DEMO-CEDAR-COM-001' }), { code: 'AMOUNT_OVERFLOW' });
  assert.equal(JSON.stringify(unresolved), unchanged);
});

test('duplicate resolution that activates overflowing cash is rejected atomically', async () => {
  const state = await importRows(createSeedState(), [
    settlement('DEMO-CEDAR-PAY-104', '90071992547409.91', 'DEMO-CEDAR-COM-001', 'USD', 'DEMO-BANK-C902', 'DEMO-CEDAR'),
    settlement('DEMO-CEDAR-PAY-105', '90071992547409.91', 'DEMO-CEDAR-COM-001', 'USD', 'DEMO-BANK-C902', 'DEMO-CEDAR'),
  ]);
  await assert.rejects(applyMutation(state, 'event/resolve', { eventId: 'DEMO-CEDAR-PAY-105', resolution: 'duplicate' }), { code: 'AMOUNT_OVERFLOW' });
  assert.equal(state.events.find(item => item.id === 'DEMO-CEDAR-PAY-105').resolution, null);
});

test('metadata and attestations accept only explicit synthetic schema and known actors', async () => {
  const state = createSeedState();
  for (const metadata of [{ ...legal, demo: false }, { ...legal, deal_id: 'DEMO-CEDAR' }, { ...legal, filename: 'actual.pdf' }, { ...legal, attested_by: 'REAL-OPERATOR' }, { ...legal, sha256: 'not-a-digest' }, { ...legal, sha256: ['d'.repeat(64)] }, { ...legal, email: 'person@example.com' }]) {
    await assert.rejects(applyMutation(state, 'legal', { dealId: 'DEMO-AURORA', metadata }), { code: 'INVALID_LEGAL' });
  }
  const next = await applyMutation(state, 'legal', { dealId: 'DEMO-AURORA', metadata: legal });
  assert.equal(next.deals[0].legal.status, 'final'); iso(next.deals[0].legal.uploadedAt);
  assert.deepEqual(next.audit[0].metadata, legal);
  await assert.rejects(applyMutation(state, 'attest', { dealId: 'DEMO-CEDAR', kind: 'kyc', attested: 'true', actor: ACTOR }), { code: 'INVALID_ATTESTATION' });
  const withdrawn = await applyMutation(state, 'attest', { dealId: 'DEMO-CEDAR', kind: 'kyc', attested: false, actor: ACTOR });
  assert.ok(reconcile(withdrawn, 'DEMO-CEDAR').blockers.some(item => item.code === 'KYC_ATTESTATION_MISSING'));
  iso(withdrawn.deals[2].attestations.kyc.at);
});

test('full Aurora route imports, matches, attaches metadata, reviews and exports exact current hash', async () => {
  const [cc, pc] = await loadSamples();
  let state = await applyImport(createSeedState(), prepareImport(createSeedState(), cc, pc));
  state = await applyMutation(state, 'match', { dealId: 'DEMO-AURORA', eventId: 'DEMO-AURORA-PAY-003', commitmentId: 'DEMO-AURORA-COM-002' });
  state = await applyMutation(state, 'legal', { dealId: 'DEMO-AURORA', metadata: legal });
  assert.equal(reconcile(state, 'DEMO-AURORA').ready, true);
  state = await applyMutation(state, 'review/request', { dealId: 'DEMO-AURORA' });
  assert.equal(state.deals[0].review.requestedRevision, state.revision);
  assert.equal(state.deals[0].review.requestedHash, await revisionHash(state, 'DEMO-AURORA')); iso(state.deals[0].review.requestedAt);
  state = await applyMutation(state, 'review/approve', { dealId: 'DEMO-AURORA', reviewer: REVIEWER, confirmed: true });
  const exported = await packet(state, 'DEMO-AURORA');
  assert.equal(exported.revision, 6); assert.equal(exported.snapshotHash, await revisionHash(state, 'DEMO-AURORA'));
  assert.equal(exported.review.approvedRevision, exported.revision); iso(exported.review.approvedAt);
  assert.equal(exported.review.reviewer, REVIEWER); assert.equal(exported.deal.review, undefined);
  assert.equal(exported.audit.at(-1).actor, REVIEWER); assert.equal(exported.demo, true);
  assert.match(exported.notice, /No signatures, transfers/);
});

test('review requires readiness, an explicit current request, known reviewer and confirmation', async () => {
  const state = createSeedState();
  await assert.rejects(applyMutation(state, 'review/request', { dealId: 'DEMO-AURORA' }), { code: 'NOT_READY' });
  await assert.rejects(applyMutation(state, 'review/approve', { dealId: 'DEMO-CEDAR', reviewer: REVIEWER, confirmed: true }), { code: 'STALE_REVIEW' });
  const requested = await applyMutation(state, 'review/request', { dealId: 'DEMO-CEDAR' });
  await assert.rejects(applyMutation(requested, 'review/approve', { dealId: 'DEMO-CEDAR', reviewer: REVIEWER, confirmed: false }), { code: 'INVALID_REVIEWER' });
  await assert.rejects(applyMutation(requested, 'review/approve', { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-UNKNOWN', confirmed: true }), { code: 'INVALID_REVIEWER' });
  await assert.rejects(packet(state, 'DEMO-CEDAR'), { code: 'NOT_APPROVED' });
  await assert.rejects(packet(state, 'DEMO-UNKNOWN'), { code: 'UNKNOWN_DEAL' });
});

test('hash canonicalises object keys/array order and excludes audit and review fields', async () => {
  const state = createSeedState(), hash = await revisionHash(state, 'DEMO-CEDAR');
  const mutated = copy(state); mutated.commitments.reverse(); mutated.events.reverse();
  mutated.deals[2].review = { arbitrary: 'excluded' }; mutated.audit.push({ arbitrary: 'excluded' });
  assert.equal(await revisionHash(mutated, 'DEMO-CEDAR'), hash);
  mutated.revision += 1; assert.notEqual(await revisionHash(mutated, 'DEMO-CEDAR'), hash);
});

test('export hash binds the exact raw snapshot and calculated fees, allocations and cash accounts', async () => {
  const exported = await packet(await approvedCedar(), 'DEMO-CEDAR');
  const { snapshotHash, review, audit, notice, ...hashedSnapshot } = exported;
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  assert.equal(await digest(hashedSnapshot), snapshotHash);
  assert.equal(hashedSnapshot.calculationRuleVersion, 'DEMO-CLOSE-CONTROL-RULES-1');
  hashedSnapshot.reconciliation.fee.allocations[0].amountMinor = '35001';
  assert.notEqual(await digest(hashedSnapshot), snapshotHash);
});

test('any successful mutation invalidates all reviews and old export approval', async () => {
  const approved = await approvedCedar(); const oldHash = await revisionHash(approved, 'DEMO-CEDAR');
  const changed = await applyMutation(approved, 'attest', { dealId: 'DEMO-AURORA', kind: 'leadRequest', attested: true, actor: ACTOR });
  assert.equal(changed.revision, approved.revision + 1);
  assert.equal(changed.deals[2].review, null); assert.notEqual(await revisionHash(changed, 'DEMO-CEDAR'), oldHash);
  await assert.rejects(packet(changed, 'DEMO-CEDAR'), { code: 'NOT_APPROVED' });
});

test('exact idempotent reimport preserves approved state and revision, while new import invalidates it', async () => {
  const approved = await approvedCedar();
  const row = settlement('DEMO-CEDAR-PAY-001', '10000', 'DEMO-CEDAR-COM-001', 'USD', 'DEMO-BANK-C001', 'DEMO-CEDAR');
  const same = await applyImport(approved, prepareImport(approved, CH, payments(row)));
  assert.equal(JSON.stringify(same), JSON.stringify(approved)); assert.equal((await packet(same, 'DEMO-CEDAR')).review.status, 'approved');
  const changed = await importRows(approved, [settlement('DEMO-AURORA-PAY-113')]);
  assert.equal(changed.deals[2].review, null);
});

test('stale preview and stale revision mutations reject without input changes; reset is monotonic', async () => {
  const state = createSeedState(); const prep = prepareImport(state, CH, payments(settlement('DEMO-AURORA-PAY-113')));
  const next = await applyMutation(state, 'fee', { dealId: 'DEMO-AURORA', payer: 'lead' });
  await assert.rejects(applyImport(next, prep), { code: 'STALE_REVISION' });
  await assert.rejects(applyMutation(next, 'fee', { dealId: 'DEMO-AURORA', payer: 'lead', expectedRevision: 1 }), { code: 'STALE_REVISION' });
  const reset = await applyMutation(next, 'reset');
  assert.equal(reset.revision, next.revision + 1); assert.deepEqual(reset.events, state.events);
  assert.equal(reset.audit.at(-1).operation, 'reset'); assert.equal(reset.audit.length, 2); iso(reset.audit.at(-1).at);
});

test('tampered review revision/hash never authorises export or approval', async () => {
  const approved = await approvedCedar(); const tampered = copy(approved); tampered.deals[2].review.approvedHash = '0'.repeat(64);
  await assert.rejects(packet(tampered, 'DEMO-CEDAR'), { code: 'NOT_APPROVED' });
  const requested = await applyMutation(createSeedState(), 'review/request', { dealId: 'DEMO-CEDAR' });
  requested.deals[2].review.requestedRevision -= 1;
  await assert.rejects(applyMutation(requested, 'review/approve', { dealId: 'DEMO-CEDAR', reviewer: REVIEWER, confirmed: true }), { code: 'STALE_REVIEW' });
});

test('shared limits reject byte/row amplification and accumulated commitments/events/audit', async () => {
  const state = createSeedState();
  assert.equal(prepareImport(state, CH, `${PH}\n${'é'.repeat(LIMITS.csvBytes / 2)}`).valid, false);
  assert.equal(prepareImport(state, CH, payments(...Array.from({ length: 101 }, (_, index) => settlement(`DEMO-AURORA-PAY-${String(index + 200).padStart(3, "0")}`)))).valid, false);
  const crowded = copy(state);
  while (crowded.events.length < LIMITS.events) { const index = crowded.events.length; crowded.events.push({ ...crowded.events[0], id: `DEMO-AURORA-PAY-${String(index + 200).padStart(3, "0")}`, commitmentId: null, importedCommitmentId: null, bankReference: `DEMO-BANK-A${String(index + 200).padStart(3, "0")}`, amountMinor: '1' }); }
  assert.equal(prepareImport(crowded, CH, payments(settlement('DEMO-AURORA-PAY-114'))).errors[0].code, 'SESSION_LIMIT');
  const manyCommitments = copy(state);
  while (manyCommitments.commitments.length < LIMITS.commitments) { const index = manyCommitments.commitments.length; manyCommitments.commitments.push({ ...manyCommitments.commitments[0], id: `DEMO-AURORA-COM-${String(index + 100).padStart(3, "0")}`, amountMinor: '1' }); }
  assert.equal(prepareImport(manyCommitments, commitments('DEMO-AURORA-COM-999,DEMO-AURORA,DEMO-INVESTOR-A3,GBP,1'), PH).errors[0].code, 'SESSION_LIMIT');
  const fullAudit = copy(state); fullAudit.audit = Array.from({ length: LIMITS.audit }, (_, index) => ({ id: `DEMO-AUDIT-${index}` }));
  await assert.rejects(applyMutation(fullAudit, 'fee', { dealId: 'DEMO-AURORA', payer: 'lead' }), { code: 'SESSION_LIMIT' });
  assert.equal(fullAudit.revision, 1);
});
