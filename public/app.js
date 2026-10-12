import { formatMoney, revisionHash, prepareImport } from '/shared/domain.js';

const $ = (selector, root = document) => root.querySelector(selector);
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (minor, currency) => e(formatMoney(String(minor ?? '0'), currency));
const sum = values => values.reduce((total, value) => total + BigInt(value || '0'), 0n).toString();
const nonzero = value => BigInt(value || '0') !== 0n;
const shortHash = hash => hash ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : 'Calculating snapshot hash…';
const date = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
const timestamp = value => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' }).format(new Date(value)) + ' UTC' : 'Time not recorded';
const sources = {
  closing: 'https://help.joinodin.com/hc/en-gb/articles/25652990575121-What-is-closing-and-when-do-I-know-a-deal-has-closed',
  drafting: 'https://help.joinodin.com/hc/en-gb/articles/25326486288273-Drafting-a-primary-deal',
};
let data = null;
let selectedDeal = 'DEMO-AURORA';
let tab = 'overview';
let hashes = {};
let busy = false;
let pendingImport = null;
let matchingEvent = null;
let reviewedRevision = null;
let packetData = null;
let lastFocus = null;
let queueSearch = '';
let queueFilter = 'all';

function announce(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = !message;
}
function inlineError(id, message) {
  const node = $(`#${id}`);
  node.textContent = message;
  node.hidden = !message;
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The session service returned an unreadable response. Please try again.'); }
  if (!response.ok) {
    const error = new Error(result?.error?.message || `The request failed (${response.status}).`);
    error.status = response.status; error.code = result?.error?.code; error.details = result?.error?.details;
    throw error;
  }
  return result;
}
async function receive(next) {
  if (!next?.state || !Array.isArray(next.queue) || !next.reconciliations) throw new Error('The session service returned an incomplete workspace.');
  data = next;
  if (!data.state.deals.some(deal => deal.id === selectedDeal)) selectedDeal = data.state.deals[0]?.id;
  hashes = Object.fromEntries(await Promise.all(data.state.deals.map(async deal => [deal.id, await revisionHash(data.state, deal.id)])));
  render();
}
async function refresh() { await receive(await api('/api/state')); }
async function recover(error, errorId) {
  let message = error.message;
  if (error.status === 409) {
    try {
      await refresh();
      pendingImport = null;
      $('#import-confirm').disabled = true;
      $('#import-confirm').hidden = true;
      $('#review-check').checked = false;
      message = `The saved revision changed. The workspace has refreshed to revision ${data.state.revision}. Review the latest changes and preview or request review again before retrying. ${error.message}`;
    } catch { message = 'The saved revision changed, but the workspace could not refresh. Reload before trying again.'; }
  }
  if (errorId) inlineError(errorId, message); else showError(message);
  return message;
}
function setBusy(value, form) {
  busy = value;
  $('#workbench').setAttribute('aria-busy', String(value));
  $('#import-open').disabled = value || !data;
  $('#reset-open').disabled = value || !data;
  if (form) {
    form.setAttribute('aria-busy', String(value));
    form.querySelectorAll('button[type="submit"]').forEach(button => button.disabled = value);
  }
  document.querySelectorAll('[data-mutate]').forEach(button => button.disabled = value || button.dataset.unavailable === 'true');
}
async function mutate(operation, payload, message, { errorId, form, expectedRevision } = {}) {
  if (busy || !data) return false;
  showError(''); if (errorId) inlineError(errorId, '');
  setBusy(true, form);
  try {
    await receive(await api(`/api/${operation}`, { ...payload, expectedRevision: expectedRevision ?? data.state.revision }));
    announce(message);
    return true;
  } catch (error) { await recover(error, errorId); return false; }
  finally { setBusy(false, form); }
}
function current() { return data?.state.deals.find(deal => deal.id === selectedDeal); }
function rec(dealId = selectedDeal) { return data.reconciliations[dealId]; }
function status(deal, reconciliation) {
  if (deal.review?.status === 'approved' && deal.review.approvedRevision === data.state.revision) return { label: 'Current revision approved', style: 'ready', next: 'Inspect the reviewed handoff packet', owner: 'Deal Operations' };
  if (deal.review?.status === 'requested' && deal.review.requestedRevision === data.state.revision) return { label: 'Human review requested', style: 'review', next: 'Review and approve this snapshot', owner: 'Reviewer' };
  if (reconciliation.ready) return { label: 'Ready for human review', style: 'ready', next: 'Request human review', owner: 'Deal Operations' };
  const first = reconciliation.blockers[0];
  const labels = { UNDERPAYMENT: 'Cash short', OVERPAYMENT: 'Overpayment', DUPLICATE_REFERENCE: 'Duplicate receipt', WRONG_CURRENCY: 'Currency mismatch', UNASSIGNED_EVENT: 'Receipt unmatched', FINAL_LEGAL_MISSING: 'Final legals missing', KYC_ATTESTATION_MISSING: 'Human attestation needed', LEAD_REQUEST_MISSING: 'Close request missing', PARENT_QUARANTINED: 'Adjustment quarantined' };
  const next = { UNDERPAYMENT: 'Review the short cash account', OVERPAYMENT: 'Resolve the excess cash', DUPLICATE_REFERENCE: 'Review duplicate payment events', WRONG_CURRENCY: 'Resolve the receipt currency', UNASSIGNED_EVENT: 'Match the unassigned receipt', FINAL_LEGAL_MISSING: 'Attach final legal metadata', KYC_ATTESTATION_MISSING: 'Record a human attestation', LEAD_REQUEST_MISSING: 'Record the Deal Lead request', PARENT_QUARANTINED: 'Review the parent settlement' };
  const owner = ['FINAL_LEGAL_MISSING', 'LEAD_REQUEST_MISSING'].includes(first.code) ? 'Deal Lead' : first.code === 'KYC_ATTESTATION_MISSING' ? 'Deal Operations' : 'Financial Ops';
  return { label: labels[first.code] || first.title, style: 'blocked', next: next[first.code] || first.title, owner };
}
function chip(label, style = 'neutral') { return `<span class="chip ${e(style)}">${e(label)}</span>`; }
function sourceLink(which, label) { return `<a class="source-link" href="${sources[which]}" target="_blank" rel="noopener noreferrer">${e(label)} <span class="icon icon-ne" aria-hidden="true"></span></a>`; }
function initials(deal) { return deal.name.split(' ').map(word => word[0]).slice(0, 2).join(''); }
function overview() {
  const rows = data.queue;
  const attention = rows.filter(row => !row.ready).length;
  const reviewed = rows.filter(row => row.review?.status === 'approved' && row.review.approvedRevision === data.state.revision).length;
  const unresolved = sum(rows.map(row => String(row.unresolvedEvents.length)));
  const currencyCards = ['GBP', 'EUR', 'USD'].map(currency => {
    const accounts = rows.filter(row => row.currency === currency).flatMap(row => row.accounts);
    const settled = sum(accounts.map(account => account.settledMinor));
    const due = sum(accounts.map(account => account.dueMinor));
    return `<div><span class="currency-pill">${currency}</span><div class="currency-amount">${money(settled, currency).replace(`${currency} `, '')}</div><div class="currency-caption">Matched, settled cash</div><div class="currency-expected">${money(due, currency).replace(`${currency} `, '')}</div><div class="currency-caption">Expected principal + fees</div></div>`;
  }).join('');
  return `<section class="overview" aria-label="Portfolio readiness overview"><div><p class="eyebrow">PORTFOLIO AT A GLANCE</p><div class="overview-top"><h2>Every close.<br>Every detail.</h2><div class="session-status">Saved synthetic session<br>Revision ${e(data.state.revision)}</div></div><div class="metrics"><div><div class="metric-value">${e(attention)}<span>/${e(rows.length)}</span></div><div class="metric-label">Deals need<br>attention</div></div><div><div class="metric-value">${e(rows.filter(row => row.ready).length)}<span>/${e(rows.length)}</span></div><div class="metric-label">Ready for<br>human review</div></div><div><div class="metric-value">${e(reviewed)}<span>/${e(rows.length)}</span></div><div class="metric-label">Current revisions<br>approved</div></div></div></div><div class="overview-cash"><div class="cash-title"><h3>Cash by deal currency</h3><span>${e(unresolved)} unresolved event${unresolved === '1' ? '' : 's'}</span></div><div class="currency-columns">${currencyCards}</div><p class="cash-footnote">Currencies stay separate. No FX conversion or netted portfolio total.<br>Quarantined, wrong-currency and unassigned receipts are excluded from matched cash.</p></div></section>`;
}
function queue() {
  const rows = [...data.queue].sort((a, b) => a.targetCloseDate.localeCompare(b.targetCloseDate) || (b.severityRank || 0) - (a.severityRank || 0) || a.id.localeCompare(b.id));
  return `<section aria-labelledby="queue-title"><div class="section-heading"><div><h2 id="queue-title">The close queue</h2><p>Three fictional deals. One next action for each.</p></div><span class="sort-label"><span class="sort-icon" aria-hidden="true">↕</span>Target date, then severity</span></div><div class="queue-toolbar"><div class="search-wrap"><label class="sr-only" for="queue-search">Find a synthetic deal</label><span aria-hidden="true">⌕</span><input id="queue-search" type="search" placeholder="Find a deal…" value="${e(queueSearch)}" autocomplete="off"></div><label class="sr-only" for="queue-filter">Filter by readiness</label><select id="queue-filter"><option value="all" ${queueFilter === 'all' ? 'selected' : ''}>All deals</option><option value="attention" ${queueFilter === 'attention' ? 'selected' : ''}>Needs attention</option><option value="ready" ${queueFilter === 'ready' ? 'selected' : ''}>Ready for human review</option><option value="approved" ${queueFilter === 'approved' ? 'selected' : ''}>Current revision approved</option></select></div><div class="queue" role="list"><div class="queue-labels" aria-hidden="true"><span>Deal</span><span>Target close</span><span>Readiness</span><span>Assignee</span><span>Next action / evidence</span><span></span></div>${rows.map(deal => {
    const s = status(deal, deal), selected = deal.id === selectedDeal;
    return `<div class="queue-row${selected ? ' selected' : ''}" role="listitem" data-queue-deal="${e(deal.id)}"><div><button class="deal-name" data-select-deal="${e(deal.id)}" aria-controls="deal-detail" ${selected ? 'aria-current="true"' : ''}><span class="deal-initials" aria-hidden="true">${e(initials(deal))}</span>${e(deal.name)}</button><div class="deal-meta">${money(deal.principalMinor, deal.currency)} principal</div></div><div class="date-cell">${e(date(deal.targetCloseDate))}<small>Illustrative target</small></div><div>${chip(s.label, s.style)}<div class="status-sub">${deal.blockers.length ? `${e(deal.blockers.length)} blocking check${deal.blockers.length === 1 ? '' : 's'}` : 'All readiness checks met'}</div></div><div class="owner">${e(s.owner)}<small class="mono">${e(s.owner === 'Reviewer' ? 'DEMO-REVIEWER-01' : deal.assignee)}</small></div><div class="next-action">${e(s.next)}<button class="queue-evidence" data-deal-evidence="${e(deal.id)}">${e(deal.evidenceSources?.[0]?.label || 'Synthetic cash ledger')} <span class="icon icon-ne" aria-hidden="true"></span></button></div><button class="row-arrow" data-select-deal="${e(deal.id)}" aria-label="Inspect ${e(deal.name)}" aria-controls="deal-detail"><span class="icon icon-ne" aria-hidden="true"></span></button></div>`;
  }).join('')}</div><div class="queue-empty empty-state" id="queue-empty" role="status" hidden><h3>No deals match this view.</h3><p>Try a different deal name or readiness filter.</p><button class="button outline" data-clear-filters>Clear filters →</button></div></section>`;
}
function applyQueueFilters() {
  const query = queueSearch.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll('[data-queue-deal]').forEach(row => {
    const deal = data.queue.find(item => item.id === row.dataset.queueDeal);
    const approved = deal.review?.status === 'approved' && deal.review.approvedRevision === data.state.revision;
    const matches = `${deal.name} ${deal.id} ${deal.currency}`.toLowerCase().includes(query)
      && (queueFilter === 'all' || queueFilter === 'attention' && !deal.ready || queueFilter === 'ready' && deal.ready && !approved || queueFilter === 'approved' && approved);
    row.hidden = !matches; if (matches) visible++;
  });
  if ($('#queue-empty')) $('#queue-empty').hidden = visible > 0;
  const labels = $('.queue-labels'); if (labels) labels.hidden = !visible;
}
function checkRow({ title, description, complete, source, sourceLabel, action }) {
  return `<li class="check-row"><span class="check-icon ${complete ? 'ready' : 'blocked'}" aria-label="${complete ? 'Met' : 'Blocking'}">${complete ? '✓' : '!'}</span><div><h4 class="check-title">${e(title)}</h4><p class="check-description">${e(description)}</p>${source ? sourceLink(source, sourceLabel) : ''}</div>${action || ''}</li>`;
}
function overviewTab(deal, r) {
  const cashBlockers = r.blockers.filter(blocker => !['FINAL_LEGAL_MISSING', 'KYC_ATTESTATION_MISSING', 'LEAD_REQUEST_MISSING'].includes(blocker.code));
  const hasUnassigned = r.unresolvedEvents.some(event => event.type === 'settlement' && !event.commitmentId && event.currency === deal.currency);
  const firstUnassigned = r.unresolvedEvents.find(event => event.type === 'settlement' && !event.commitmentId && event.currency === deal.currency);
  const rows = [
    { title: cashBlockers.length ? 'Cash reconciled · attention needed' : 'Cash reconciled to every account', description: cashBlockers.length ? cashBlockers[0].detail : 'Principal and illustrative fees are funded. Every receipt has an explicit account; no unresolved cash exceptions.', complete: !cashBlockers.length, source: 'closing', sourceLabel: 'Source: funds collected before closing', action: hasUnassigned ? `<button class="check-action" id="match-topup" data-match-event="${e(firstUnassigned.id)}">Match receipt →</button>` : `<button class="check-action" data-tab="ledger">Inspect cash →</button>` },
    { title: deal.legal.status === 'final' ? 'Final legal metadata attached' : 'Final legal metadata missing', description: deal.legal.status === 'final' ? `${deal.legal.filename} · synthetic reference and SHA-256 recorded by ${deal.legal.attestedBy}.` : 'A draft reference is present. Attach the supplied final metadata fixture before human review.', complete: deal.legal.status === 'final', source: 'drafting', sourceLabel: 'Source: final agreement can delay closing', action: `<button class="check-action" id="legal-open" data-open-legal>${deal.legal.status === 'final' ? 'Inspect evidence' : 'Attach metadata'} →</button>` },
    { title: 'Human KYC attestation', description: deal.attestations.kyc.attested ? `Synthetic operator ${deal.attestations.kyc.actor} has attested. This is no automated regulatory decision.` : 'A human synthetic attestation is required. This prototype does not check identity or determine regulatory status.', complete: deal.attestations.kyc.attested, action: !deal.attestations.kyc.attested ? '<button class="check-action" data-attest="kyc" data-mutate>Attest synthetic KYC →</button>' : `<button class="check-action" data-tab="evidence">View attestation →</button>` },
    { title: 'Deal Lead close request', description: deal.attestations.leadRequest.attested ? `Synthetic request recorded by ${deal.attestations.leadRequest.actor}. No funds have been sent.` : 'Record the synthetic Deal Lead request. Cash arrival alone does not start the closing process.', complete: deal.attestations.leadRequest.attested, source: 'closing', sourceLabel: 'Source: the Deal Lead starts closing', action: !deal.attestations.leadRequest.attested ? '<button class="check-action" data-attest="leadRequest" data-mutate>Attest close request →</button>' : '<button class="check-action" data-tab="evidence">View request →</button>' },
  ];
  const settled = sum(r.accounts.map(account => account.settledMinor));
  const shortfall = sum(r.accounts.map(account => account.shortfallMinor));
  const excess = sum(r.accounts.map(account => account.overpaymentMinor));
  const due = sum(r.accounts.map(account => account.dueMinor));
  const progress = BigInt(due) ? Number(BigInt(settled) * 100n / BigInt(due)) : 0;
  return `<div class="detail-grid"><section><h3 class="panel-title">Readiness checklist</h3><p class="panel-description">Deterministic checks, with evidence and an accountable human.</p><ul class="checklist">${rows.map(checkRow).join('')}</ul></section><aside class="detail-sidebar"><div class="cash-card"><p class="eyebrow">MATCHED, SETTLED CASH</p><div class="cash-card-total money">${money(settled, deal.currency)}</div><p class="cash-card-label">Across investment and fee cash accounts</p><div class="cash-card-breakdown"><div><span>Principal expected</span><span class="money">${money(r.principalMinor, deal.currency)}</span></div><div><span>Illustrative fees</span><span class="money">${money(r.fee.totalMinor, deal.currency)}</span></div><div class="divider"><span>Cash shortfall</span><span class="money${nonzero(shortfall) ? ' amount-bad' : ''}">${money(shortfall, deal.currency)}</span></div>${nonzero(excess) ? `<div><span>Overpayment</span><span class="money amount-bad">${money(excess, deal.currency)}</span></div>` : ''}</div><progress class="cash-progress" aria-label="Matched cash as percentage of expected cash" max="100" value="${Math.min(progress, 100)}">${Math.min(progress, 100)}%</progress><p class="cash-progress-note">${e(r.unresolvedEvents.length)} unresolved event${r.unresolvedEvents.length === 1 ? '' : 's'} · ${r.fee.payer === 'lead' ? 'Deal Lead' : 'Investors'} pay fees</p></div>${reviewCard(deal, r)}</aside></div>`;
}
function reviewCard(deal, r) {
  if (deal.review?.status === 'approved' && deal.review.approvedRevision === data.state.revision) return `<div class="review-card"><h3>Reviewed and ready to hand off.</h3><p>DEMO-REVIEWER-01 approved revision ${e(data.state.revision)}. Export the exact snapshot and its cash ledger.</p><button class="button ink" id="packet-open" data-open-packet>Open reviewed packet <span class="icon icon-ne" aria-hidden="true"></span></button><p class="small">A synthetic handoff. No signatures or transfers executed.</p></div>`;
  if (deal.review?.status === 'requested' && deal.review.requestedRevision === data.state.revision) return `<div class="review-card"><h3>Human review requested.</h3><p>Revision ${e(data.state.revision)} is waiting for the synthetic reviewer’s explicit sign-off.</p><button class="button lime" id="review-open" data-open-review>Review current revision →</button><p class="small mono">SHA-256 ${e(shortHash(hashes[deal.id]))}</p></div>`;
  return `<div class="review-card"><h3>${r.ready ? 'Ready for a human handoff.' : 'A few details to resolve.'}</h3><p>${r.ready ? 'All readiness checks are met. Request an explicit review of this saved revision.' : `${e(r.blockers.length)} blocking check${r.blockers.length === 1 ? '' : 's'} must be resolved before a review can be requested.`}</p><button class="button ${r.ready ? 'ink' : 'outline'}" id="review-request" data-request-review data-mutate data-unavailable="${!r.ready}" ${r.ready ? '' : 'disabled'}>Request human review →</button><p class="small">Readiness is calculated. Approval is a human action.</p></div>`;
}
function eventStatus(event, deal, r) {
  if (event.resolution === 'duplicate') return { text: 'Excluded duplicate', style: 'neutral', detail: 'Preserved for audit' };
  if (event.currency !== deal.currency) return { text: 'Wrong currency', style: 'blocked', detail: `Requires ${deal.currency}; no FX conversion` };
  if (r.blockers.some(blocker => blocker.code === 'DUPLICATE_REFERENCE' && blocker.evidence.includes(event.id))) return { text: 'Quarantined duplicate', style: 'warn', detail: 'Excluded from matched cash' };
  if (r.unresolvedEvents.some(item => item.id === event.id)) return { text: event.commitmentId ? 'Unresolved' : 'Unassigned receipt', style: 'warn', detail: 'Needs explicit human resolution' };
  return { text: event.type === 'settlement' ? 'Matched settlement' : `Linked ${event.type}`, style: 'ready', detail: event.type === 'settlement' ? 'Included in matched cash' : `Subtracts from ${event.parentEventId}` };
}
function eventAction(event, deal, r) {
  if (event.resolution === 'duplicate') return '';
  if (r.blockers.some(blocker => blocker.code === 'DUPLICATE_REFERENCE' && blocker.evidence.includes(event.id))) return `<button class="button outline small-button" data-resolve-event="${e(event.id)}" data-mutate>Exclude as duplicate</button>`;
  if (!event.commitmentId && event.type === 'settlement' && event.currency === deal.currency) return `<button class="button outline small-button" data-match-event="${e(event.id)}">Match receipt →</button>`;
  return '';
}
function ledgerTab(deal, r) {
  const settled = sum(r.accounts.map(account => account.settledMinor));
  const shortfall = sum(r.accounts.map(account => account.shortfallMinor));
  const overpayment = sum(r.accounts.map(account => account.overpaymentMinor));
  const exceptions = r.unresolvedEvents.length ? `<div class="exception-box"><h3>${e(r.unresolvedEvents.length)} cash event${r.unresolvedEvents.length === 1 ? '' : 's'} awaiting resolution</h3><p>Unassigned receipts, duplicate-reference groups and wrong-currency payments stay out of matched cash. Refunds and reversals are linked to their original settlement. Every row is retained.</p></div>` : '';
  const accounts = r.accounts.map(account => `<tr><td><span class="cell-main">${e(account.label)}</span><span class="cell-sub mono">${e(account.id)}</span></td><td class="numeric money">${money(account.principalMinor, deal.currency)}</td><td class="numeric money">${money(account.feeMinor, deal.currency)}</td><td class="numeric money">${money(account.settledMinor, deal.currency)}</td><td class="numeric money${nonzero(account.shortfallMinor) ? ' amount-bad' : ''}">${money(account.shortfallMinor, deal.currency)}</td><td class="numeric money${nonzero(account.overpaymentMinor) ? ' amount-bad' : ''}">${money(account.overpaymentMinor, deal.currency)}</td></tr>`).join('');
  const events = r.events.map(event => {
    const s = eventStatus(event, deal, r);
    return `<tr><td><span class="cell-main mono">${e(event.id)}</span><span class="cell-sub mono">${e(event.bankReference)}</span></td><td>${e(event.type)}<span class="cell-sub mono">${event.parentEventId ? `Parent: ${e(event.parentEventId)}` : 'No parent event'}</span></td><td class="numeric money">${event.type === 'settlement' ? '' : '− '}${money(event.amountMinor, event.currency)}</td><td><span class="mono">${e(event.commitmentId || 'Unassigned')}</span></td><td>${chip(s.text, s.style)}<span class="cell-sub">${e(s.detail)}</span>${eventAction(event, deal, r)}</td></tr>`;
  }).join('');
  return `<h3 class="panel-title">Cash that can be explained.</h3><p class="panel-description">Exact minor-unit arithmetic. Every account reconciled separately.</p><div class="ledger-summary"><div class="ledger-stat"><span>Matched, settled</span><strong class="money">${money(settled, deal.currency)}</strong></div><div class="ledger-stat"><span>Shortfall across accounts</span><strong class="money${nonzero(shortfall) ? ' amount-bad' : ''}">${money(shortfall, deal.currency)}</strong></div><div class="ledger-stat"><span>Overpayment across accounts</span><strong class="money${nonzero(overpayment) ? ' amount-bad' : ''}">${money(overpayment, deal.currency)}</strong></div><div class="ledger-stat"><span>Unresolved cash events</span><strong>${e(r.unresolvedEvents.length)}</strong></div></div>${exceptions}<div class="table-scroll" tabindex="0" role="region" aria-label="Cash accounts, scroll horizontally for all amounts"><table><caption>Cash accounts · ${e(deal.currency)} only</caption><thead><tr><th scope="col">Account</th><th scope="col" class="numeric">Principal due</th><th scope="col" class="numeric">Fee due</th><th scope="col" class="numeric">Settled</th><th scope="col" class="numeric">Shortfall</th><th scope="col" class="numeric">Overpayment</th></tr></thead><tbody>${accounts}</tbody></table></div><p class="table-note">A portfolio surplus never clears an individual account shortfall. Fee cash stays separate from invested principal. Scroll horizontally to inspect every amount.</p><h3 class="table-title">The complete event ledger</h3><div class="table-scroll" tabindex="0" role="region" aria-label="Payment events, scroll horizontally for all evidence"><table><caption>All ${e(r.events.length)} events · exclusions and adjustments retained</caption><thead><tr><th scope="col">Event / bank reference</th><th scope="col">Type / parent</th><th scope="col" class="numeric">Amount</th><th scope="col">Explicit account</th><th scope="col">Treatment / human action</th></tr></thead><tbody>${events}</tbody></table></div>${feePanel(deal, r)}`;
}
function feePanel(deal, r) {
  return `<section class="fee-panel"><div><h3>Fee payer is part of readiness.</h3><p><strong>Illustrative only; this is not Odin pricing.</strong> ${money(r.fee.fixedMinor, deal.currency)} fixed + 0.5% of ${money(r.principalMinor, deal.currency)} principal = ${money(r.fee.totalMinor, deal.currency)}.</p><p>${e(r.fee.rounding)} Changing payer changes the account amounts due and invalidates any review.</p>${sourceLink('drafting', 'Source: fee payer affects capital available')}</div><form class="fee-control" id="fee-form"><label for="fee-payer">Who pays this illustrative fee?</label><div><select id="fee-payer"><option value="lead" ${deal.feePayer === 'lead' ? 'selected' : ''}>Deal Lead</option><option value="investors" ${deal.feePayer === 'investors' ? 'selected' : ''}>Investors</option></select><button type="submit" class="button ink" data-mutate>Apply →</button></div></form></section>`;
}
function evidenceTab(deal, r) {
  const rdy = r.ready ? 'All readiness checks are met.' : `${r.blockers.length} readiness checks still block review.`;
  return `<h3 class="panel-title">Evidence, in one place.</h3><p class="panel-description">Public workflow sources support the checklist. Synthetic evidence supports this exact revision.</p><section class="evidence-card"><h3>Final legal metadata</h3><p>${deal.legal.status === 'final' ? 'A synthetic final document reference is attached. The JSON fixture and digest are human-attested; no real document was verified.' : 'Only a synthetic draft reference is present. Final legal metadata is required before human review.'}</p>${chip(deal.legal.status === 'final' ? 'Final metadata attached' : 'Draft reference · blocking', deal.legal.status === 'final' ? 'ready' : 'blocked')}<dl class="evidence-list"><dt>Document reference</dt><dd class="mono">${e(deal.legal.filename || 'None')}</dd><dt>SHA-256</dt><dd class="mono">${e(deal.legal.sha256 || 'Not yet recorded')}</dd><dt>Attested by</dt><dd class="mono">${e(deal.legal.attestedBy || 'Not yet attested')}</dd></dl><button class="button outline" id="legal-open" data-open-legal>Attach final metadata →</button> ${sourceLink('drafting', 'Public source: drafting a primary deal')}</section><section class="evidence-card"><h3>Human synthetic attestations</h3><p>These record human statements in a demonstration. They do not perform identity checks or regulatory approval.</p><dl class="evidence-list"><dt>KYC attestation</dt><dd>${deal.attestations.kyc.attested ? 'Recorded' : 'Missing'} · <span class="mono">${e(deal.attestations.kyc.actor || 'No operator')}</span></dd><dt>Lead close request</dt><dd>${deal.attestations.leadRequest.attested ? 'Recorded' : 'Missing'} · <span class="mono">${e(deal.attestations.leadRequest.actor || 'No operator')}</span></dd></dl>${!deal.attestations.kyc.attested ? '<button class="button outline" data-attest="kyc" data-mutate>Attest synthetic KYC →</button>' : ''}${!deal.attestations.leadRequest.attested ? '<button class="button outline" data-attest="leadRequest" data-mutate>Attest synthetic close request →</button>' : ''}${sourceLink('closing', 'Public source: closing and the Deal Lead')}</section><section class="evidence-card"><h3>Exact revision, exact handoff.</h3><p>${e(rdy)} The SHA-256 binds the deal data, cash events and evidence to the current saved revision.</p><dl class="evidence-list"><dt>Session revision</dt><dd>${e(data.state.revision)}</dd><dt>Snapshot SHA-256</dt><dd class="mono">${e(hashes[deal.id])}</dd><dt>Human review</dt><dd>${e(status(deal, r).label)}</dd><dt>Reviewer</dt><dd class="mono">${e(deal.review?.reviewer || 'Not yet approved')}</dd></dl></section>${feePanel(deal, r)}`;
}
function auditTab(deal) {
  const rows = data.state.audit.filter(item => !item.dealId || item.dealId === deal.id).slice().reverse();
  const titles = { import: 'CSV import saved atomically', match: 'Receipt explicitly matched', 'event/resolve': 'Duplicate receipt explicitly excluded', legal: 'Final synthetic metadata attached', attest: 'Human synthetic attestation recorded', fee: 'Illustrative fee payer changed', 'review/request': 'Human review requested', 'review/approve': 'Current revision approved by reviewer', reset: 'Synthetic session reset' };
  const rowHtml = rows.map(item => {
    const details = [item.eventId && `Event ${item.eventId}`, item.commitmentId && `Account ${item.commitmentId}`, item.kind && `Attestation ${item.kind}`, item.payer && `Fee payer ${item.payer}`, item.summary && `${item.summary.newEvents} new events; ${item.summary.newCommitments} new commitments; ${item.summary.updatedCommitments} updated commitments; ${item.summary.idempotentEvents} idempotent events`, item.metadata && `Document ${item.metadata.filename}`, item.resolution && `Resolution ${item.resolution}`].filter(Boolean).join(' · ');
    return `<li class="audit-row"><div class="audit-date">Revision ${e(item.revision)}<br><span class="mono">${e(item.id)}</span></div><span class="audit-dot" aria-hidden="true">✓</span><div class="audit-content"><strong>${e(titles[item.operation] || item.operation)}</strong><p><time datetime="${e(item.at || '')}">${e(timestamp(item.at))}</time></p><p class="mono">${e(item.actor || 'DEMO-OPERATOR-01')}</p>${details ? `<p>${e(details)}</p>` : ''}${item.snapshotHash ? `<p class="mono">SHA-256 ${e(item.snapshotHash)}</p>` : ''}</div></li>`;
  }).join('');
  return `<h3 class="panel-title">A visible chain of decisions.</h3><p class="panel-description">Saved operations, recorded UTC timestamps and synthetic actors. Every revision remains inspectable.</p>${rows.length ? `<ol class="audit-list">${rowHtml}</ol>` : '<div class="empty-state"><h2>No operator actions yet.</h2><p>This deal is still at the seed state. Imports, matches, evidence changes and reviews will appear here.</p></div>'}`;
}
function detail() {
  const deal = current(), r = rec(), s = status(deal, r);
  const count = { overview: r.blockers.length, ledger: r.events.length, evidence: '', audit: data.state.audit.filter(item => !item.dealId || item.dealId === deal.id).length };
  const content = tab === 'ledger' ? ledgerTab(deal, r) : tab === 'evidence' ? evidenceTab(deal, r) : tab === 'audit' ? auditTab(deal) : overviewTab(deal, r);
  return `<section class="detail-shell" id="deal-detail" aria-labelledby="deal-title"><header class="detail-header"><div class="detail-heading-wrap"><span class="deal-initials" aria-hidden="true">${e(initials(deal))}</span><div><p class="eyebrow">DEAL WORKBENCH · FICTIONAL RECORD</p><h2 id="deal-title" tabindex="-1">${e(deal.name)}</h2><p class="detail-subtitle">${e(deal.id)} · Target ${e(date(deal.targetCloseDate))} · ${money(r.principalMinor, deal.currency)} principal</p></div></div><div class="detail-status">${chip(s.label, s.style)}<span class="revision">Revision ${e(data.state.revision)} · <span class="mono">${e(shortHash(hashes[deal.id]))}</span></span></div></header><div class="tabs" role="tablist" aria-label="Deal workbench sections">${[['overview', 'Overview'], ['ledger', 'Cash ledger'], ['evidence', 'Evidence'], ['audit', 'Audit trail']].map(([id, label]) => `<button class="tab" id="tab-${id}" role="tab" data-tab="${id}" aria-controls="detail-panel" aria-selected="${tab === id}" tabindex="${tab === id ? '0' : '-1'}">${label}${count[id] !== '' ? `<span class="tab-count">${e(count[id])}</span>` : ''}</button>`).join('')}</div><div class="detail-content" id="detail-panel" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0">${deal.review?.status === 'approved' && deal.review.approvedRevision === data.state.revision ? `<div class="approved-note">Revision ${e(data.state.revision)} is approved by DEMO-REVIEWER-01. Any relevant change clears this approval. <button class="button ghost small-button" data-open-packet>Inspect packet <span class="icon icon-ne" aria-hidden="true"></span></button></div>` : ''}${content}</div></section>`;
}
function render() {
  $('#workbench').innerHTML = data.state.deals.length ? `${overview()}${queue()}${detail()}<div class="workflow-hint"><span class="hint-number" aria-hidden="true"><span class="icon icon-ne" aria-hidden="true"></span></span><p><strong>Try the Aurora handoff.</strong> Download and import both CSV fixtures, match the ${money('200000', 'GBP')} receipt to DEMO-AURORA-COM-002, attach final legal metadata, then request and approve a human review. The packet contains the reviewed revision.</p></div>` : '<section class="empty-state"><h2>Your queue is empty.</h2><p>Reset the synthetic session to explore the three example deals.</p></section>';
  setBusy(busy);
  applyQueueFilters();
}
function openModal(id) {
  lastFocus = document.activeElement;
  const dialog = $(`#${id}`);
  dialog.showModal();
  const initial = dialog.querySelector('[data-close]') || dialog.querySelector('input, select, button');
  initial?.focus();
}
function closeModal(dialog) { if (dialog.open) dialog.close(); }
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target.closest('[data-close]')) closeModal(dialog); });
  dialog.addEventListener('close', () => { if (lastFocus?.isConnected) lastFocus.focus(); else $('#deal-title')?.focus(); });
  // Native modal dialogs handle Escape and make the document inert. Explicit cycling also
  // keeps Tab in the dialog in browser engines with incomplete focus containment.
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
});

$('#import-open').addEventListener('click', () => { inlineError('import-errors', ''); openModal('import-dialog'); });
$('#reset-open').addEventListener('click', () => { inlineError('reset-error', ''); openModal('reset-dialog'); });
$('#reset-confirm').addEventListener('click', async () => {
  if (await mutate('reset', {}, 'The seed workspace has been restored. All records remain synthetic.', { errorId: 'reset-error' })) {
    selectedDeal = 'DEMO-AURORA'; tab = 'overview'; pendingImport = null; $('#import-form').reset(); clearPreview(); render(); closeModal($('#reset-dialog'));
  }
});
function clearPreview() {
  pendingImport = null; $('#import-preview').hidden = true; $('#import-confirm').hidden = true; $('#import-confirm').disabled = true;
}
['commitments-file', 'payments-file', 'import-ack'].forEach(id => $(`#${id}`).addEventListener('change', clearPreview));
function renderPreview(preview) {
  const summary = preview.summary || {};
  const diffRows = [...(preview.diff?.commitments || []).map(change => ({ ...change, source: 'Commitment' })), ...(preview.diff?.events || []).map(change => ({ ...change, source: 'Payment' }))];
  const errors = preview.errors || [];
  const errorHtml = errors.length ? `<div class="inline-error" role="alert"><strong>${e(errors.length)} validation error${errors.length === 1 ? '' : 's'}. Nothing has been imported.</strong><ul>${errors.map(error => `<li>${e(error.source || 'CSV')}${error.row ? ` · row ${e(error.row)}` : ''}${error.field ? ` · ${e(error.field)}` : ''}: ${e(error.message)}</li>`).join('')}</ul></div>` : '';
  const rowsHtml = diffRows.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Import change preview"><table><caption>Changes to apply atomically</caption><thead><tr><th scope="col">Source</th><th scope="col">Action / ID</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${diffRows.map(change => `<tr><td>${e(change.source)}</td><td>${e(change.action)}<span class="cell-sub mono">${e(change.after?.id || change.before?.id)}</span></td><td class="money">${change.before ? money(change.before.amountMinor, change.before.currency) : 'New row'}</td><td><span class="money">${money(change.after.amountMinor, change.after.currency)}</span>${change.source === 'Payment' ? `<span class="cell-sub mono">${e(change.after.commitmentId || 'Unassigned · human match required')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p>No cash or commitment changes. Existing identical payment IDs are idempotent.</p>';
  $('#import-preview').innerHTML = `<h3>${preview.valid ? 'Validated. Ready for your decision.' : 'A few rows need attention.'}</h3><div class="preview-stats"><div class="preview-stat"><strong>${e((summary.newCommitments || 0) + (summary.updatedCommitments || 0))}</strong>Commitment changes</div><div class="preview-stat"><strong>${e(summary.newEvents || 0)}</strong>New payment events</div><div class="preview-stat"><strong>${e(summary.idempotentEvents || 0)}</strong>Idempotent events</div></div>${errorHtml}${rowsHtml}<p class="mono">Base revision ${e(preview.revision ?? preview.baseRevision)}${preview.previewHash ? ` · Preview SHA-256 ${e(shortHash(preview.previewHash))}` : ''}</p><p>Server-validated preview. All changes succeed together or none are saved. Matching and duplicate exclusion remain explicit human actions.</p>`;
  $('#import-preview').hidden = false;
  $('#import-confirm').hidden = !preview.valid;
  $('#import-confirm').disabled = !preview.valid;
}
async function readFile(input, limit, label) {
  const file = input.files[0];
  if (!file) throw new Error(`Choose the ${label} file first.`);
  if (file.size > limit) throw new Error(`${label} exceeds the ${Math.round(limit / 1024)} KiB limit. Use a bounded synthetic fixture.`);
  return file.text();
}
$('#import-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !data || !$('#import-form').reportValidity()) return;
  clearPreview(); inlineError('import-errors', ''); setBusy(true, $('#import-form')); $('#preview-button').textContent = 'Validating with the server…';
  try {
    const [commitmentsCsv, paymentsCsv] = await Promise.all([readFile($('#commitments-file'), 32768, 'commitments CSV'), readFile($('#payments-file'), 32768, 'payments CSV')]);
    const expectedRevision = data.state.revision;
    const clientPreview = prepareImport(data.state, commitmentsCsv, paymentsCsv);
    const preview = await api('/api/import/preview', { commitmentsCsv, paymentsCsv, expectedRevision });
    if (clientPreview.valid !== preview.valid) throw new Error('Validation rules differ from the saved service. Reload the workspace before importing. Nothing has been imported.');
    renderPreview(preview);
    if (!preview.valid) inlineError('import-errors', `${preview.errors?.length || 1} validation error(s). Nothing has been imported. Inspect the row errors below and choose corrected files.`);
    if (preview.valid) pendingImport = { commitmentsCsv, paymentsCsv, expectedRevision, previewHash: preview.previewHash };
  } catch (error) { await recover(error, 'import-errors'); }
  finally { setBusy(false, $('#import-form')); $('#preview-button').innerHTML = 'Preview import <span class="icon icon-ne" aria-hidden="true"></span>'; }
});
$('#import-confirm').addEventListener('click', async () => {
  if (!pendingImport || !$('#import-ack').checked || busy) return;
  $('#import-confirm').disabled = true;
  const pending = pendingImport;
  if (await mutate('import', { commitmentsCsv: pending.commitmentsCsv, paymentsCsv: pending.paymentsCsv, previewHash: pending.previewHash }, 'CSV changes saved atomically. Match any unassigned receipt before requesting review.', { errorId: 'import-errors', form: $('#import-form'), expectedRevision: pending.expectedRevision })) {
    clearPreview(); selectedDeal = 'DEMO-AURORA'; tab = 'overview'; render(); closeModal($('#import-dialog'));
  } else $('#import-confirm').disabled = !pendingImport;
});

function openMatch(eventId) {
  const deal = current(), r = rec();
  const event = r.events.find(item => item.id === eventId);
  if (!event) return;
  matchingEvent = { id: event.id, dealId: deal.id, revision: data.state.revision };
  inlineError('match-error', '');
  $('#match-event').innerHTML = `<div class="modal-summary"><span class="money">${money(event.amountMinor, event.currency)}</span><p class="mono">${e(event.id)}</p><p class="mono">Bank reference ${e(event.bankReference)}</p><p>No account is assigned. Choose from this deal’s known synthetic accounts.</p></div>`;
  $('#match-account').innerHTML = `<option value="">Select an account…</option>${r.accounts.map(account => `<option value="${e(account.id)}">${e(account.id)} · ${e(account.label)} · ${money(account.shortfallMinor, deal.currency)} short</option>`).join('')}`;
  openModal('match-dialog');
}
$('#match-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!matchingEvent || !$('#match-form').reportValidity()) return;
  if (await mutate('match', { dealId: matchingEvent.dealId, eventId: matchingEvent.id, commitmentId: $('#match-account').value }, 'The receipt has been explicitly matched. Cash accounts and readiness are recalculated.', { errorId: 'match-error', form: $('#match-form'), expectedRevision: matchingEvent.revision })) closeModal($('#match-dialog'));
});
let legalContext = null;
function openLegal() {
  legalContext = { dealId: selectedDeal, revision: data.state.revision };
  inlineError('legal-error', ''); $('#legal-form').reset(); openModal('legal-dialog');
}
$('#legal-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!legalContext || busy || !$('#legal-form').reportValidity()) return;
  inlineError('legal-error', '');
  try {
    const text = await readFile($('#legal-file'), 8192, 'final legal metadata');
    let metadata;
    try { metadata = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Use the supplied final-legal.json fixture.'); }
    if (await mutate('legal', { dealId: legalContext.dealId, metadata }, 'Final synthetic legal metadata has been attached. The exact document digest is available in Evidence.', { errorId: 'legal-error', form: $('#legal-form'), expectedRevision: legalContext.revision })) closeModal($('#legal-dialog'));
  } catch (error) { inlineError('legal-error', error.message); }
});
function openReview() {
  const deal = current(), r = rec();
  reviewedRevision = { revision: data.state.revision, dealId: deal.id };
  inlineError('review-error', ''); $('#review-check').checked = false;
  $('#review-summary').innerHTML = `<div class="modal-summary"><h3>${e(deal.name)}</h3><p>All ${e(r.accounts.length)} cash accounts meet their expected amounts. ${e(r.unresolvedEvents.length)} unresolved events.</p><dl class="evidence-list"><dt>Current revision</dt><dd>${e(data.state.revision)}</dd><dt>Principal</dt><dd class="money">${money(r.principalMinor, deal.currency)}</dd><dt>Illustrative fees</dt><dd class="money">${money(r.fee.totalMinor, deal.currency)}</dd><dt>Final reference</dt><dd class="mono">${e(deal.legal.filename)}</dd><dt>Snapshot SHA-256</dt><dd class="mono">${e(hashes[deal.id])}</dd></dl></div>`;
  $('#review-ack-text').textContent = `As DEMO-REVIEWER-01, I have inspected this synthetic snapshot and explicitly approve revision ${data.state.revision} for ${deal.name}, including its cash, evidence and human attestations.`;
  openModal('review-dialog');
}
$('#review-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!reviewedRevision || !$('#review-form').reportValidity()) return;
  if (await mutate('review/approve', { dealId: reviewedRevision.dealId, reviewer: 'DEMO-REVIEWER-01', confirmed: $('#review-check').checked }, 'The current synthetic revision is approved. Open the reviewed handoff packet to inspect and export it.', { errorId: 'review-error', form: $('#review-form'), expectedRevision: reviewedRevision.revision })) closeModal($('#review-dialog'));
});
async function openPacket() {
  if (busy) return;
  setBusy(true); showError('');
  try {
    const deal = current(), revision = data.state.revision;
    packetData = await api(`/api/export?dealId=${encodeURIComponent(deal.id)}&revision=${revision}`);
    inlineError('packet-error', '');
    $('#packet-download').disabled = false;
    $('#ledger-download').removeAttribute('aria-disabled');
    const packet = packetData;
    $('#packet-summary').innerHTML = `<div class="approved-note">${e(packet.notice)}</div><div class="modal-summary"><h3>${e(packet.deal.name)}</h3><dl class="evidence-list"><dt>Approved revision</dt><dd>${e(packet.revision)}</dd><dt>Human reviewer</dt><dd class="mono">${e(packet.review.reviewer)}</dd><dt>Principal</dt><dd class="money">${money(packet.reconciliation.principalMinor, packet.deal.currency)}</dd><dt>Final reference</dt><dd class="mono">${e(packet.deal.legal.filename)}</dd><dt>Snapshot SHA-256</dt><dd class="mono">${e(packet.snapshotHash)}</dd><dt>Audit operations</dt><dd>${e(packet.audit.length)} retained</dd></dl></div>`;
    $('#packet-json').textContent = JSON.stringify(packetData, null, 2);
    $('#ledger-download').href = `/api/export/ledger?dealId=${encodeURIComponent(deal.id)}&revision=${revision}`;
    openModal('packet-dialog');
  } catch (error) { await recover(error); }
  finally { setBusy(false); }
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function failPacketDownload(error) {
  await recover(error, 'packet-error');
  if (error.status === 409) {
    packetData = null;
    $('#packet-download').disabled = true;
    $('#ledger-download').removeAttribute('href');
    $('#ledger-download').setAttribute('aria-disabled', 'true');
    $('#packet-json').textContent = 'This packet is stale. Close this view and request a fresh review of the current revision.';
  }
}
$('#packet-download').addEventListener('click', async () => {
  if (!packetData || busy) return;
  const requested = { dealId: packetData.deal.id, revision: packetData.revision };
  $('#packet-download').disabled = true; setBusy(true); inlineError('packet-error', '');
  try {
    // Revalidate at the server for every download, including after a second tab changes state.
    const fresh = await api(`/api/export?dealId=${encodeURIComponent(requested.dealId)}&revision=${requested.revision}`);
    packetData = fresh;
    downloadBlob(new Blob([JSON.stringify(fresh, null, 2)], { type: 'application/json' }), `${fresh.deal.id}-reviewed-revision-${fresh.revision}.json`);
    announce(`Reviewed revision ${fresh.revision} downloaded after server revalidation.`);
  } catch (error) { await failPacketDownload(error); }
  finally { setBusy(false); $('#packet-download').disabled = !packetData; }
});
$('#ledger-download').addEventListener('click', async event => {
  event.preventDefault(); if (!packetData || busy) return;
  const requested = { dealId: packetData.deal.id, revision: packetData.revision };
  setBusy(true); $('#ledger-download').setAttribute('aria-disabled', 'true'); inlineError('packet-error', '');
  try {
    const response = await fetch(`/api/export/ledger?dealId=${encodeURIComponent(requested.dealId)}&revision=${requested.revision}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'text/csv' } });
    if (!response.ok) {
      let result; try { result = await response.json(); } catch { result = {}; }
      const error = new Error(result.error?.message || 'The reviewed cash ledger could not be downloaded.'); error.status = response.status; throw error;
    }
    downloadBlob(new Blob([await response.text()], { type: 'text/csv' }), `${requested.dealId}-cash-ledger-revision-${requested.revision}.csv`);
    announce(`Reviewed cash ledger revision ${requested.revision} downloaded after server revalidation.`);
  } catch (error) { await failPacketDownload(error); }
  finally { setBusy(false); if (packetData) $('#ledger-download').removeAttribute('aria-disabled'); }
});
function changeTab(next, focus = false) {
  if (!['overview', 'ledger', 'evidence', 'audit'].includes(next)) return;
  tab = next; render(); if (focus) $(`#tab-${tab}`)?.focus();
}
$('#workbench').addEventListener('click', async event => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.hasAttribute('data-clear-filters')) { queueSearch = ''; queueFilter = 'all'; render(); $('#queue-search')?.focus(); return; }
  if (target.dataset.dealEvidence) { selectedDeal = target.dataset.dealEvidence; tab = 'evidence'; render(); $('#deal-title')?.focus(); return; }
  if (target.dataset.selectDeal) { selectedDeal = target.dataset.selectDeal; tab = 'overview'; render(); $('#deal-title')?.focus(); return; }
  if (target.dataset.tab) { changeTab(target.dataset.tab, true); return; }
  if (target.dataset.matchEvent) { openMatch(target.dataset.matchEvent); return; }
  if (target.hasAttribute('data-open-legal')) { openLegal(); return; }
  if (target.hasAttribute('data-open-review')) { openReview(); return; }
  if (target.hasAttribute('data-open-packet')) { await openPacket(); return; }
  if (target.hasAttribute('data-request-review')) { await mutate('review/request', { dealId: selectedDeal }, 'Human review requested for the saved revision. The synthetic reviewer must explicitly inspect and approve it.'); return; }
  if (target.dataset.attest) { await mutate('attest', { dealId: selectedDeal, kind: target.dataset.attest, attested: true, actor: 'DEMO-OPERATOR-01' }, 'The human synthetic attestation has been recorded. This is not an automated compliance decision.'); return; }
  if (target.dataset.resolveEvent) { await mutate('event/resolve', { eventId: target.dataset.resolveEvent, resolution: 'duplicate' }, 'The chosen event is excluded as a duplicate and retained in the audit ledger. The remaining receipt is reconciled.'); }
});
$('#workbench').addEventListener('input', event => { if (event.target.id === 'queue-search') { queueSearch = event.target.value; applyQueueFilters(); } });
$('#workbench').addEventListener('change', event => { if (event.target.id === 'queue-filter') { queueFilter = event.target.value; applyQueueFilters(); } });
$('#workbench').addEventListener('submit', async event => {
  if (event.target.id !== 'fee-form') return;
  event.preventDefault();
  await mutate('fee', { dealId: selectedDeal, payer: $('#fee-payer').value }, 'The illustrative fee payer has changed. Amounts due are recalculated; any prior review is invalidated.', { form: event.target });
});
$('#workbench').addEventListener('keydown', event => {
  if (event.target.getAttribute('role') !== 'tab') return;
  const ids = ['overview', 'ledger', 'evidence', 'audit'];
  const index = ids.indexOf(tab);
  const next = event.key === 'ArrowRight' ? ids[(index + 1) % ids.length] : event.key === 'ArrowLeft' ? ids[(index + ids.length - 1) % ids.length] : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1) : null;
  if (next) { event.preventDefault(); changeTab(next, true); }
});
async function initialize() {
  showError(''); announce('');
  $('#workbench').setAttribute('aria-busy', 'true');
  try { await api('/api/session', {}); await refresh(); }
  catch (error) {
    data = null;
    $('#workbench').innerHTML = '<section class="empty-state"><h2>The workspace could not connect.</h2><p>The synthetic session service is unavailable. No local data or simulated results are being substituted.</p><button class="button ink" id="retry-connect">Try connecting again →</button></section>';
    $('#retry-connect').addEventListener('click', initialize);
    showError(error.message);
  } finally { setBusy(false); }
}
initialize();
