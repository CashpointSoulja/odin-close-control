// Ayo Ahmed's synthetic Close Control concept. Integer minor units only.
export const CURRENCY_DECIMALS = Object.freeze({ GBP: 2, EUR: 2, USD: 2, JPY: 0, KWD: 3 });
export const MAX_MINOR = 9007199254740991n;
export const ACTOR = 'DEMO-OPERATOR-01';
export const REVIEWER = 'DEMO-REVIEWER-01';
export const LIMITS = Object.freeze({ csvBytes: 32768, csvRows: 100, events: 500, commitments: 30, audit: 1000 });
const SEED_AT = '2026-10-12T09:00:00.000Z';
const CLOSING_GUIDE = 'https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed';
const DRAFTING_GUIDE = 'https://help.joinodin.com/hc/en-gb/articles/25326486288273-Drafting-a-primary-deal';
export const INVESTORS = Object.freeze({
  'DEMO-INVESTOR-A1': { label: 'Maple Grove Capital · fictional', dealId: 'DEMO-AURORA' },
  'DEMO-INVESTOR-A2': { label: 'Linden Ventures · fictional', dealId: 'DEMO-AURORA' },
  'DEMO-INVESTOR-A3': { label: 'Juniper Partners · fictional', dealId: 'DEMO-AURORA' },
  'DEMO-INVESTOR-H1': { label: 'Willow Capital · fictional', dealId: 'DEMO-HARBOUR' },
  'DEMO-INVESTOR-H2': { label: 'Birch Partners · fictional', dealId: 'DEMO-HARBOUR' },
  'DEMO-INVESTOR-C1': { label: 'Elm Ventures · fictional', dealId: 'DEMO-CEDAR' },
  'DEMO-INVESTOR-C2': { label: 'Aspen Capital · fictional', dealId: 'DEMO-CEDAR' },
});

function fail(message, code = 'INVALID_INPUT', status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function decimals(currency) {
  if (!Object.hasOwn(CURRENCY_DECIMALS, currency)) fail('Use a supported uppercase currency.', 'INVALID_CURRENCY');
  return CURRENCY_DECIMALS[currency];
}
function bounded(value) {
  if (value < 0n || value > MAX_MINOR) fail('Amount exceeds the supported minor-unit range.', 'AMOUNT_OVERFLOW');
  return value;
}
function total(values) { return values.reduce((sum, value) => bounded(sum + BigInt(value)), 0n); }
function minor(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) fail('Minor units must be a canonical unsigned integer string.');
  return bounded(BigInt(value));
}
export function parseAmount(value, currency) {
  const places = decimals(currency);
  if (typeof value !== 'string' || value.length > 40 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    fail('Use an unsigned plain decimal amount, without grouping or exponent notation.', 'INVALID_AMOUNT');
  }
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places || (places === 0 && value.includes('.'))) fail(`Currency ${currency} permits ${places} decimal places.`, 'INVALID_AMOUNT');
  return bounded(BigInt(whole) * (10n ** BigInt(places)) + BigInt(fraction.padEnd(places, '0') || '0')).toString();
}
export function formatMoney(value, currency) {
  const places = decimals(currency);
  const amount = minor(value);
  const scale = 10n ** BigInt(places);
  const whole = (amount / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${whole}${places ? `.${(amount % scale).toString().padStart(places, '0')}` : ''}`;
}
function dealFor(state, id) {
  const deal = state.deals.find(item => item.id === id);
  if (!deal) fail('Unknown synthetic deal.', 'UNKNOWN_DEAL');
  return deal;
}
export function feeAccountId(dealId) { return `${dealId}-FEE`; }
function commitmentFor(state, id) { return state.commitments.find(item => item.id === id); }
function isAccount(state, dealId, id) {
  return id === feeAccountId(dealId) || state.commitments.some(item => item.id === id && item.dealId === dealId);
}
function event(id, dealId, commitmentId, currency, amount, bankReference, type = 'settlement', parentEventId = null) {
  return { id, dealId, commitmentId, importedCommitmentId: commitmentId, currency,
    amountMinor: parseAmount(amount, currency), type, parentEventId, bankReference, resolution: null };
}
function commitment(id, dealId, investorId, currency, amount) {
  return { id, dealId, investorId, label: INVESTORS[investorId].label, currency, amountMinor: parseAmount(amount, currency) };
}
function finalLegal(dealId) {
  return { status: 'final', filename: `${dealId}-FINAL.pdf`, sha256: 'a'.repeat(64), attestedBy: ACTOR, uploadedAt: SEED_AT };
}
function attestation(attested) { return { attested, actor: attested ? ACTOR : null, at: attested ? SEED_AT : null, evidence: 'Synthetic human attestation only.' }; }
export function createSeedState() {
  const deals = [
    { id: 'DEMO-AURORA', name: 'Aurora Works', company: 'Aurora Works · fictional', currency: 'GBP', targetCloseDate: '2026-10-14', feePayer: 'lead',
      legal: { status: 'draft', filename: 'DEMO-AURORA-DRAFT.pdf', sha256: null, attestedBy: null, uploadedAt: null },
      attestations: { kyc: attestation(true), leadRequest: attestation(true) }, review: null },
    { id: 'DEMO-HARBOUR', name: 'Harbour Studio', company: 'Harbour Studio · fictional', currency: 'EUR', targetCloseDate: '2026-10-16', feePayer: 'lead',
      legal: finalLegal('DEMO-HARBOUR'), attestations: { kyc: attestation(true), leadRequest: attestation(false) }, review: null },
    { id: 'DEMO-CEDAR', name: 'Cedar Systems', company: 'Cedar Systems · fictional', currency: 'USD', targetCloseDate: '2026-10-19', feePayer: 'lead',
      legal: finalLegal('DEMO-CEDAR'), attestations: { kyc: attestation(true), leadRequest: attestation(true) }, review: null },
  ];
  deals.forEach(deal => { deal.assignee = ACTOR; });
  const commitments = [
    commitment('DEMO-AURORA-COM-001', 'DEMO-AURORA', 'DEMO-INVESTOR-A1', 'GBP', '30000.00'),
    commitment('DEMO-AURORA-COM-002', 'DEMO-AURORA', 'DEMO-INVESTOR-A2', 'GBP', '20000.00'),
    commitment('DEMO-HARBOUR-COM-001', 'DEMO-HARBOUR', 'DEMO-INVESTOR-H1', 'EUR', '25000.00'),
    commitment('DEMO-HARBOUR-COM-002', 'DEMO-HARBOUR', 'DEMO-INVESTOR-H2', 'EUR', '15000.00'),
    commitment('DEMO-CEDAR-COM-001', 'DEMO-CEDAR', 'DEMO-INVESTOR-C1', 'USD', '10000.00'),
    commitment('DEMO-CEDAR-COM-002', 'DEMO-CEDAR', 'DEMO-INVESTOR-C2', 'USD', '10000.00'),
  ];
  const events = [
    event('DEMO-AURORA-PAY-001', 'DEMO-AURORA', 'DEMO-AURORA-COM-001', 'GBP', '30000.00', 'DEMO-BANK-A001'),
    event('DEMO-AURORA-PAY-002', 'DEMO-AURORA', 'DEMO-AURORA-COM-002', 'GBP', '18000.00', 'DEMO-BANK-A002'),
    event('DEMO-AURORA-FEE-001', 'DEMO-AURORA', 'DEMO-AURORA-FEE', 'GBP', '500.00', 'DEMO-BANK-AF01'),
    event('DEMO-HARBOUR-PAY-001', 'DEMO-HARBOUR', 'DEMO-HARBOUR-COM-001', 'EUR', '25000.00', 'DEMO-BANK-H001'),
    event('DEMO-HARBOUR-PAY-002', 'DEMO-HARBOUR', 'DEMO-HARBOUR-COM-001', 'EUR', '25000.00', 'DEMO-BANK-H001'),
    event('DEMO-HARBOUR-PAY-003', 'DEMO-HARBOUR', 'DEMO-HARBOUR-COM-002', 'EUR', '15000.00', 'DEMO-BANK-H003'),
    event('DEMO-HARBOUR-REV-001', 'DEMO-HARBOUR', 'DEMO-HARBOUR-COM-002', 'EUR', '1000.00', 'DEMO-BANK-HR01', 'reversal', 'DEMO-HARBOUR-PAY-003'),
    event('DEMO-HARBOUR-PAY-004', 'DEMO-HARBOUR', 'DEMO-HARBOUR-COM-002', 'GBP', '1000.00', 'DEMO-BANK-H004'),
    event('DEMO-HARBOUR-FEE-001', 'DEMO-HARBOUR', 'DEMO-HARBOUR-FEE', 'EUR', '450.00', 'DEMO-BANK-HF01'),
    event('DEMO-CEDAR-PAY-001', 'DEMO-CEDAR', 'DEMO-CEDAR-COM-001', 'USD', '10000.00', 'DEMO-BANK-C001'),
    event('DEMO-CEDAR-PAY-002', 'DEMO-CEDAR', 'DEMO-CEDAR-COM-002', 'USD', '10000.00', 'DEMO-BANK-C002'),
    event('DEMO-CEDAR-FEE-001', 'DEMO-CEDAR', 'DEMO-CEDAR-FEE', 'USD', '350.00', 'DEMO-BANK-CF01'),
  ];
  return { revision: 1, deals, commitments, events, audit: [] };
}

function fees(state, deal) {
  const commitments = state.commitments.filter(item => item.dealId === deal.id).sort((a, b) => a.id.localeCompare(b.id));
  const principal = total(commitments.map(item => item.amountMinor));
  const fixed = 250n * (10n ** BigInt(decimals(deal.currency)));
  const variable = (principal * 50n + 5000n) / 10000n; // Half up to the nearest minor unit.
  const amount = bounded(fixed + variable);
  let allocations;
  if (deal.feePayer === 'lead') {
    allocations = [{ accountId: feeAccountId(deal.id), amountMinor: amount.toString() }];
  } else {
    if (!principal) fail('Fee allocation requires positive committed principal.');
    const rows = commitments.map(item => ({ accountId: item.id, amount: amount * BigInt(item.amountMinor) / principal,
      remainder: amount * BigInt(item.amountMinor) % principal }));
    let remainder = amount - total(rows.map(item => item.amount));
    const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? a.accountId.localeCompare(b.accountId) : a.remainder > b.remainder ? -1 : 1);
    for (const row of ranked) { if (!remainder) break; row.amount += 1n; remainder -= 1n; }
    allocations = rows.map(item => ({ accountId: item.accountId, amountMinor: item.amount.toString() }));
  }
  return { totalMinor: amount.toString(), fixedMinor: fixed.toString(), variableMinor: variable.toString(), payer: deal.feePayer,
    basisPoints: 50, rounding: 'Variable fee: half up. Investor allocation: largest remainder; ties by commitment ID.', allocations };
}
function duplicateGroups(events) {
  const groups = new Map();
  for (const item of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
    if (item.type !== 'settlement' || item.resolution === 'duplicate') continue;
    const key = JSON.stringify([item.bankReference, item.currency, item.amountMinor]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].filter(group => group.length > 1);
}
export function reconcile(state, dealId) {
  const deal = dealFor(state, dealId);
  const dealCommitments = state.commitments.filter(item => item.dealId === dealId).sort((a, b) => a.id.localeCompare(b.id));
  const events = state.events.filter(item => item.dealId === dealId).sort((a, b) => a.id.localeCompare(b.id));
  const fee = fees(state, deal);
  const accounts = dealCommitments.map(item => ({ id: item.id, label: item.label, kind: 'investment', principalMinor: item.amountMinor,
    feeMinor: fee.allocations.find(allocation => allocation.accountId === item.id)?.amountMinor || '0' }));
  accounts.push({ id: feeAccountId(dealId), label: 'Deal Lead fee cash · fictional', kind: 'fee', principalMinor: '0',
    feeMinor: fee.payer === 'lead' ? fee.totalMinor : '0' });
  for (const account of accounts) {
    account.dueMinor = bounded(BigInt(account.principalMinor) + BigInt(account.feeMinor)).toString();
    account.settledMinor = '0'; account.eventIds = [];
  }
  total(accounts.map(account => account.dueMinor));
  const blockers = [], unresolved = new Set();
  const add = (code, title, detail, evidence = [], eventId, severity = 'blocked') => {
    blockers.push({ code, severity, title, detail, evidence, ...(eventId ? { eventId } : {}) });
  };
  const groups = duplicateGroups(state.events).filter(group => group.some(item => item.dealId === dealId));
  const duplicateIds = new Set(groups.flat().map(item => item.id));
  for (const group of groups) {
    group.forEach(item => unresolved.add(item.id));
    add('DUPLICATE_REFERENCE', 'Duplicate settlement reference', `${group.length} event IDs share ${group[0].bankReference}, ${formatMoney(group[0].amountMinor, group[0].currency)}. All are quarantined until a human explicitly excludes the duplicate row.`, group.map(item => item.id));
  }
  const active = events.filter(item => item.resolution !== 'duplicate');
  for (const item of active) {
    if (item.currency !== deal.currency) {
      unresolved.add(item.id); add('WRONG_CURRENCY', 'Receipt currency differs', `${item.id} is in ${item.currency}; this deal requires ${deal.currency}. No FX conversion is performed.`, [item.id], item.id); continue;
    }
    if (duplicateIds.has(item.id)) continue;
    const parent = item.type === 'settlement' ? null : events.find(other => other.id === item.parentEventId);
    if (parent && (parent.resolution === 'duplicate' || duplicateIds.has(parent.id))) {
      unresolved.add(item.id); add('PARENT_QUARANTINED', 'Adjustment parent is quarantined', `${item.id} cannot affect cash while its parent settlement is excluded or quarantined.`, [parent.id, item.id], item.id); continue;
    }
    const accountId = item.type === 'settlement' ? item.commitmentId : parent?.commitmentId;
    const account = accounts.find(other => other.id === accountId);
    if (!account) {
      unresolved.add(item.id); add('UNASSIGNED_EVENT', 'Receipt needs an explicit match', `${item.id} has no recognised cash account. Choose a synthetic commitment or fee cash account; identifiers are never guessed.`, [item.id], item.id); continue;
    }
    const delta = BigInt(item.amountMinor) * (item.type === 'settlement' ? 1n : -1n);
    account.settledMinor = (BigInt(account.settledMinor) + delta).toString();
    account.eventIds.push(item.id);
  }
  for (const account of accounts) {
    const due = BigInt(account.dueMinor), settled = BigInt(account.settledMinor);
    bounded(settled);
    const shortfall = due > settled ? due - settled : 0n, overpayment = settled > due ? settled - due : 0n;
    account.shortfallMinor = shortfall.toString(); account.overpaymentMinor = overpayment.toString();
    if (shortfall) add('UNDERPAYMENT', 'Cash account is underfunded', `${account.label} needs ${formatMoney(shortfall.toString(), deal.currency)} more.`, [account.id, ...account.eventIds]);
    if (overpayment) add('OVERPAYMENT', 'Cash account has an overpayment', `${account.label} has ${formatMoney(overpayment.toString(), deal.currency)} above its amount due. Resolve it explicitly before review.`, [account.id, ...account.eventIds]);
  }
  total(accounts.map(account => account.settledMinor));
  if (deal.legal.status !== 'final' || !deal.legal.sha256 || deal.legal.attestedBy !== ACTOR) add('FINAL_LEGAL_MISSING', 'Final legal metadata is missing', 'A draft is present. An operator must attest final synthetic document metadata; this does not verify a real document.', [deal.legal.filename].filter(Boolean));
  if (!deal.attestations.kyc.attested) add('KYC_ATTESTATION_MISSING', 'Human KYC attestation is missing', 'Record the synthetic operator attestation. The prototype does not determine regulatory status.', []);
  if (!deal.attestations.leadRequest.attested) add('LEAD_REQUEST_MISSING', 'Deal Lead close request is missing', 'Record the synthetic human close-request attestation before asking for review.', []);
  const priority = ['DUPLICATE_REFERENCE', 'WRONG_CURRENCY', 'UNASSIGNED_EVENT', 'PARENT_QUARANTINED', 'UNDERPAYMENT', 'OVERPAYMENT', 'FINAL_LEGAL_MISSING', 'KYC_ATTESTATION_MISSING', 'LEAD_REQUEST_MISSING'];
  blockers.sort((a, b) => priority.indexOf(a.code) - priority.indexOf(b.code));
  const ready = blockers.length === 0;
  const severityRank = ready ? 0 : (priority.length - Math.min(...blockers.map(item => priority.indexOf(item.code)))) * 1000 + blockers.length;
  return { dealId, currency: deal.currency, principalMinor: total(dealCommitments.map(item => item.amountMinor)).toString(),
    eligibleMinor: total(accounts.filter(item => item.kind === 'investment').map(item => item.settledMinor)).toString(), fee, accounts, blockers,
    events: clone(events), unresolvedEvents: clone(events.filter(item => unresolved.has(item.id))), ready,
    severity: ready ? 'ready' : 'blocked', severityRank, evidenceSource: 'Synthetic cash ledger and human attestations, with public workflow context.',
    evidenceSources: [{ kind: 'cash-ledger', label: 'Synthetic settlement events', eventIds: events.map(item => item.id) },
      { kind: 'public-guide', label: 'Odin closing guide', url: CLOSING_GUIDE }, { kind: 'public-guide', label: 'Odin primary-deal drafting guide', url: DRAFTING_GUIDE }],
    nextAction: ready ? 'Request human review of this revision.' : blockers[0].title };
}
export function queue(state) {
  return state.deals.map(deal => ({ ...clone(deal), ...reconcile(state, deal.id) }))
    .sort((a, b) => a.targetCloseDate.localeCompare(b.targetCloseDate) || b.severityRank - a.severityRank || a.id.localeCompare(b.id));
}

function parseCsv(input, headers, source) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > LIMITS.csvBytes) fail(`${source} must be a CSV string of at most 32 KiB.`, 'CSV_SIZE');
  const csv = input.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  function pushField() { row.push(field); field = ''; closed = false; }
  function pushRow() { pushField(); if (row.some(value => value !== '')) rows.push(row); row = []; }
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"') { if (csv[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === '"') {
      if (field || closed) fail(`${source}: malformed CSV quotes.`, 'INVALID_CSV');
      quoted = true;
    } else if (char === ',') pushField();
    else if (char === '\n') pushRow();
    else if (char === '\r') { if (csv[index + 1] === '\n') index += 1; pushRow(); }
    else { if (closed) fail(`${source}: characters after a quoted CSV field.`, 'INVALID_CSV'); field += char; }
  }
  if (quoted) fail(`${source}: unterminated CSV quote.`, 'INVALID_CSV');
  if (field || row.length || closed) pushRow();
  if (!rows.length || rows[0].length !== headers.length || !headers.every((header, index) => rows[0][index] === header)) fail(`${source}: use exactly these headers: ${headers.join(',')}.`, 'INVALID_CSV_HEADERS');
  if (rows.length > LIMITS.csvRows + 1) fail(`${source}: at most 100 data rows are supported.`, 'CSV_SIZE');
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) fail(`${source}: row ${index + 2} has ${values.length} fields; expected ${headers.length}.`, 'INVALID_CSV');
    return { row: index + 2, data: Object.fromEntries(headers.map((header, column) => [header, values[column]])) };
  });
}
function syntheticId(value, field) {
  const pattern = field === 'bank_reference' ? /^DEMO-BANK-[AHC][FR]?\d{2,3}$/ : /^DEMO-(?:AURORA|HARBOUR|CEDAR)-(?:COM|PAY|FEE|REF|REV)-\d{3}$/;
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${field} must use the fixed synthetic deal namespace and numeric suffix, without names or personal data.`, 'INVALID_SYNTHETIC_ID');
  return value;
}
const commitmentHeaders = ['commitment_id', 'deal_id', 'investor_id', 'currency', 'amount'];
const eventHeaders = ['event_id', 'deal_id', 'commitment_id', 'currency', 'amount', 'type', 'parent_event_id', 'bank_reference'];
function canonicalEvent(item) {
  return { id: item.id, dealId: item.dealId, commitmentId: Object.hasOwn(item, 'importedCommitmentId') ? item.importedCommitmentId : item.commitmentId,
    currency: item.currency, amountMinor: item.amountMinor, type: item.type, parentEventId: item.parentEventId, bankReference: item.bankReference };
}
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function validateAdjustments(events) {
  for (const item of events.filter(item => item.type !== 'settlement')) {
    const parent = events.find(other => other.id === item.parentEventId);
    if (!parent || parent.type !== 'settlement') fail(`${item.id}: refund/reversal requires an existing settlement parent.`, 'INVALID_PARENT');
    if (parent.dealId !== item.dealId || parent.currency !== item.currency) fail(`${item.id}: parent must have the same deal and currency.`, 'INVALID_PARENT');
    if (item.commitmentId && item.commitmentId !== parent.commitmentId) fail(`${item.id}: adjustment cash account must match its parent.`, 'INVALID_PARENT');
    const adjustments = total(events.filter(other => other.parentEventId === parent.id && other.type !== 'settlement').map(other => other.amountMinor));
    if (adjustments > BigInt(parent.amountMinor)) fail(`${parent.id}: total refunds/reversals exceed the original settlement.`, 'ADJUSTMENT_EXCEEDS_PARENT');
  }
}
function validateStateBounds(state) {
  if (state.commitments.length > LIMITS.commitments || state.events.length > LIMITS.events || state.audit.length > LIMITS.audit) {
    fail('Synthetic session limit reached. Reset to start a fresh scenario.', 'SESSION_LIMIT', 409);
  }
}
export function prepareImport(state, commitmentsCsv, paymentsCsv) {
  const nextState = clone(state), errors = [], diff = { commitments: [], events: [] };
  const summary = { newCommitments: 0, updatedCommitments: 0, newEvents: 0, idempotentEvents: 0 };
  let commitmentRows = [], eventRows = [];
  const addError = (source, row, field, error) => errors.push({ source, row, field, message: error.message, code: error.code || 'INVALID_INPUT' });
  try { commitmentRows = parseCsv(commitmentsCsv, commitmentHeaders, 'commitments'); } catch (error) { addError('commitments', null, null, error); }
  try { eventRows = parseCsv(paymentsCsv, eventHeaders, 'payments'); } catch (error) { addError('payments', null, null, error); }
  const seenCommitments = new Set();
  for (const { row, data } of commitmentRows) {
    try {
      const id = syntheticId(data.commitment_id, 'commitment_id');
      const deal = dealFor(nextState, data.deal_id);
      if (seenCommitments.has(id)) fail(`${id}: duplicate commitment row.`, 'DUPLICATE_COMMITMENT');
      seenCommitments.add(id);
      if (!new RegExp(`^${deal.id}-COM-\\d{3}$`).test(id)) fail('Commitment ID must identify its synthetic deal with a three-digit suffix.', 'INVALID_SYNTHETIC_ID');
      const investor = INVESTORS[data.investor_id];
      if (!investor || investor.dealId !== deal.id) fail('Choose a known fictional investor ID assigned to this deal.', 'UNKNOWN_INVESTOR');
      if (data.currency !== deal.currency) fail('Commitment currency must equal deal currency.', 'INVALID_CURRENCY');
      const amountMinor = parseAmount(data.amount, data.currency);
      if (amountMinor === '0') fail('Commitment amounts must be positive.', 'INVALID_AMOUNT');
      const item = { id, dealId: deal.id, investorId: data.investor_id, label: investor.label, currency: data.currency, amountMinor };
      const existing = commitmentFor(nextState, id);
      if (existing) {
        if (existing.investorId !== item.investorId || existing.dealId !== item.dealId) fail('Existing commitment identity cannot be reassigned.', 'COMMITMENT_CONFLICT');
        if (!equal(existing, item)) { diff.commitments.push({ action: 'update', before: clone(existing), after: item }); Object.assign(existing, item); summary.updatedCommitments += 1; }
      } else { nextState.commitments.push(item); diff.commitments.push({ action: 'add', after: item }); summary.newCommitments += 1; }
    } catch (error) { addError('commitments', row, null, error); }
  }
  for (const { row, data } of eventRows) {
    try {
      const id = syntheticId(data.event_id, 'event_id');
      dealFor(nextState, data.deal_id);
      if (!new RegExp(`^${data.deal_id}-(?:PAY|FEE|REF|REV)-\\d{3}$`).test(id)) fail('Event ID must identify its synthetic deal with a three-digit suffix.', 'INVALID_SYNTHETIC_ID');
      decimals(data.currency);
      if (!['GBP', 'EUR', 'USD'].includes(data.currency)) fail('Demo payment imports support GBP, EUR and USD.', 'INVALID_CURRENCY');
      const amountMinor = parseAmount(data.amount, data.currency);
      if (amountMinor === '0') fail('Payment-event amounts must be positive.', 'INVALID_AMOUNT');
      if (!['settlement', 'refund', 'reversal'].includes(data.type)) fail('Payment type must be settlement, refund or reversal.', 'INVALID_EVENT_TYPE');
      const commitmentId = data.commitment_id || null;
      if (commitmentId && !isAccount(nextState, data.deal_id, commitmentId)) fail('Unknown cash account: leave commitment_id blank for explicit matching.', 'UNKNOWN_COMMITMENT');
      const parentEventId = data.parent_event_id || null;
      if (data.type === 'settlement' && parentEventId) fail('Settlement events cannot have a parent.', 'INVALID_PARENT');
      if (data.type !== 'settlement' && !parentEventId) fail('Refund/reversal needs a parent_event_id.', 'INVALID_PARENT');
      if (parentEventId) syntheticId(parentEventId, 'parent_event_id');
      syntheticId(data.bank_reference, 'bank_reference');
      const item = { id, dealId: data.deal_id, commitmentId, importedCommitmentId: commitmentId, currency: data.currency,
        amountMinor, type: data.type, parentEventId, bankReference: data.bank_reference, resolution: null };
      const existing = nextState.events.find(other => other.id === id);
      if (existing) {
        if (!equal(canonicalEvent(existing), canonicalEvent(item))) fail(`${id}: event ID conflicts with a different canonical payment.`, 'EVENT_CONFLICT');
        summary.idempotentEvents += 1;
      } else { nextState.events.push(item); diff.events.push({ action: 'add', after: item }); summary.newEvents += 1; }
    } catch (error) { addError('payments', row, null, error); }
  }
  if (!errors.length) {
    try { validateStateBounds(nextState); validateAdjustments(nextState.events); nextState.deals.forEach(deal => reconcile(nextState, deal.id)); }
    catch (error) { addError('payments', null, null, error); }
  }
  return { valid: errors.length === 0, errors, summary, diff, ...(errors.length ? {} : { nextState }), baseRevision: state.revision };
}

function invalidateReviews(state) { state.deals.forEach(deal => { deal.review = null; }); }
function nextRevision(state) {
  if (!Number.isSafeInteger(state.revision) || state.revision >= Number.MAX_SAFE_INTEGER) fail('Revision limit reached.', 'REVISION_OVERFLOW', 409);
  state.revision += 1;
}
function audit(state, operation, details, at = new Date().toISOString()) {
  if (state.audit.length >= LIMITS.audit) fail('Synthetic audit limit reached. Start a fresh session.', 'SESSION_LIMIT', 409);
  state.audit.push({ id: `DEMO-AUDIT-${String(state.revision).padStart(6, '0')}`, revision: state.revision, at, actor: ACTOR, operation, ...details });
}
function requireReady(state, dealId) { if (!reconcile(state, dealId).ready) fail('Resolve every cash and attestation blocker before human review.', 'NOT_READY', 409); }
export async function applyImport(state, preparation) {
  if (!preparation?.valid || !preparation.nextState) fail('Import validation failed.', 'INVALID_IMPORT');
  if (preparation.baseRevision !== state.revision) fail('Import preview is stale; preview the current revision again.', 'STALE_REVISION', 409);
  if (!preparation.diff.commitments.length && !preparation.diff.events.length) return clone(state);
  const nextState = clone(preparation.nextState);
  validateStateBounds(nextState);
  nextRevision(nextState); invalidateReviews(nextState);
  audit(nextState, 'import', { summary: clone(preparation.summary) });
  return nextState;
}
export async function applyMutation(state, operation, payload = {}) {
  const at = new Date().toISOString();
  operation = operation.replaceAll('.', '/');
  if (payload.expectedRevision !== undefined && payload.expectedRevision !== state.revision) fail('Revision changed. Refresh and try again.', 'STALE_REVISION', 409);
  if (operation === 'reset') {
    const nextState = createSeedState(); nextState.revision = state.revision; nextRevision(nextState);
    nextState.audit = clone(state.audit); audit(nextState, 'reset', {}, at);
    return nextState;
  }
  const nextState = clone(state);
  let deal;
  if (operation !== 'event/resolve') deal = dealFor(nextState, payload.dealId);
  const requested = deal?.review ? clone(deal.review) : null;
  switch (operation) {
    case 'match': {
      const item = nextState.events.find(other => other.id === payload.eventId && other.dealId === deal.id);
      if (!item || item.type !== 'settlement') fail('Only a recognised settlement can be matched.', 'INVALID_MATCH');
      if (item.resolution === 'duplicate') fail('An excluded duplicate cannot be matched.', 'INVALID_MATCH');
      if (item.commitmentId) fail('This receipt is already matched.', 'ALREADY_MATCHED', 409);
      if (!isAccount(nextState, deal.id, payload.commitmentId)) fail('Choose a known synthetic cash account.', 'UNKNOWN_COMMITMENT');
      if (item.currency !== deal.currency) fail('A wrong-currency receipt cannot be matched into this deal.', 'WRONG_CURRENCY');
      item.commitmentId = payload.commitmentId;
      validateAdjustments(nextState.events);
      break;
    }
    case 'event/resolve': {
      const item = nextState.events.find(other => other.id === payload.eventId);
      if (!item || payload.resolution !== 'duplicate') fail('Choose an existing duplicate settlement and explicit duplicate exclusion.', 'INVALID_RESOLUTION');
      if (item.resolution === 'duplicate') fail('This duplicate is already excluded.', 'ALREADY_RESOLVED', 409);
      if (!duplicateGroups(nextState.events).some(group => group.some(other => other.id === item.id))) fail('Event is not part of an unresolved duplicate-reference group.', 'INVALID_RESOLUTION');
      if (nextState.events.some(other => other.parentEventId === item.id)) fail('This settlement has linked adjustments. Resolve the other duplicate row.', 'HAS_ADJUSTMENTS', 409);
      item.resolution = 'duplicate'; break;
    }
    case 'legal': {
      const metadata = payload.metadata;
      const fields = ['demo', 'deal_id', 'filename', 'sha256', 'attested_by'];
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).length !== fields.length || !fields.every(key => Object.hasOwn(metadata, key))) fail('Use the supplied final synthetic legal metadata schema.', 'INVALID_LEGAL');
      if (metadata.demo !== true || metadata.deal_id !== deal.id || metadata.filename !== `${deal.id}-FINAL.pdf` || metadata.attested_by !== ACTOR || typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.sha256)) fail('Final legal metadata must identify this synthetic deal, its demo PDF, digest and known operator.', 'INVALID_LEGAL');
      deal.legal = { status: 'final', filename: metadata.filename, sha256: metadata.sha256, attestedBy: metadata.attested_by, uploadedAt: at }; break;
    }
    case 'attest': {
      if (!['kyc', 'leadRequest'].includes(payload.kind) || typeof payload.attested !== 'boolean' || payload.actor !== ACTOR) fail('Use a known synthetic attestation and operator.', 'INVALID_ATTESTATION');
      deal.attestations[payload.kind] = { attested: payload.attested, actor: ACTOR, at, evidence: 'Synthetic human attestation only.' }; break;
    }
    case 'fee': {
      if (!['lead', 'investors'].includes(payload.payer)) fail('Fee payer must be lead or investors.', 'INVALID_FEE_PAYER');
      deal.feePayer = payload.payer; fees(nextState, deal); break;
    }
    case 'review/request': requireReady(nextState, deal.id); break;
    case 'review/approve': {
      requireReady(nextState, deal.id);
      if (!requested || requested.status !== 'requested' || requested.requestedRevision !== state.revision || requested.requestedHash !== await revisionHash(state, deal.id)) fail('Request a review of the current revision before approving.', 'STALE_REVIEW', 409);
      if (payload.reviewer !== REVIEWER || payload.confirmed !== true) fail('The synthetic reviewer must explicitly confirm approval.', 'INVALID_REVIEWER');
      break;
    }
    default: fail('Unknown operation.', 'UNKNOWN_OPERATION');
  }
  validateStateBounds(nextState);
  nextState.deals.forEach(item => reconcile(nextState, item.id));
  nextRevision(nextState); invalidateReviews(nextState);
  if (operation === 'review/request') deal.review = { status: 'requested', requestedRevision: nextState.revision,
    requestedHash: await revisionHash(nextState, deal.id), requestedBy: ACTOR, requestedAt: at };
  if (operation === 'review/approve') deal.review = { ...requested, status: 'approved', approvedRevision: nextState.revision,
    approvedHash: await revisionHash(nextState, deal.id), reviewer: REVIEWER, approvedAt: at };
  audit(nextState, operation, { ...(deal ? { dealId: deal.id } : {}), ...(payload.eventId ? { eventId: payload.eventId } : {}),
    ...(payload.commitmentId ? { commitmentId: payload.commitmentId } : {}), ...(payload.kind ? { kind: payload.kind, attested: payload.attested } : {}),
    ...(operation === 'event/resolve' ? { resolution: 'duplicate' } : {}), ...(operation === 'fee' ? { payer: payload.payer } : {}),
    ...(operation === 'legal' ? { metadata: clone(payload.metadata) } : {}),
    ...(operation === 'review/request' ? { requestedRevision: deal.review.requestedRevision, snapshotHash: deal.review.requestedHash } : {}),
    ...(operation === 'review/approve' ? { actor: REVIEWER, reviewer: REVIEWER, approvedRevision: deal.review.approvedRevision, snapshotHash: deal.review.approvedHash } : {}) }, at);
  return nextState;
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function snapshot(state, dealId) {
  const deal = clone(dealFor(state, dealId)); delete deal.review;
  return { demo: true, revision: state.revision, calculationRuleVersion: 'DEMO-CLOSE-CONTROL-RULES-1', deal,
    commitments: clone(state.commitments.filter(item => item.dealId === dealId).sort((a, b) => a.id.localeCompare(b.id))),
    events: clone(state.events.filter(item => item.dealId === dealId).sort((a, b) => a.id.localeCompare(b.id))),
    reconciliation: reconcile(state, dealId) };
}
export async function revisionHash(state, dealId) {
  const bytes = new TextEncoder().encode(canonicalJson(snapshot(state, dealId)));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function packet(state, dealId) {
  const deal = dealFor(state, dealId), hash = await revisionHash(state, dealId);
  requireReady(state, dealId);
  if (!deal.review || deal.review.status !== 'approved' || deal.review.approvedRevision !== state.revision || deal.review.approvedHash !== hash) fail('Only the approved current revision can be exported.', 'NOT_APPROVED', 409);
  return { ...snapshot(state, dealId), snapshotHash: hash, review: clone(deal.review),
    audit: clone(state.audit), notice: 'Synthetic human-reviewed readiness packet. No signatures, transfers, regulatory decision or real deal closing were executed.' };
}
