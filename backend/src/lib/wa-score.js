// Lead scoring (§18) — pure, unit-tested. No DB, no side effects.
//
// Scores a customer/lead from real signals only: requested quantity, buying
// frequency, historical purchase value, engagement, quotation activity and
// payment behaviour. Anything unknown simply contributes nothing rather than
// being guessed at, so a brand-new lead lands as COLD/WARM, not HOT.

const PIPELINE = [
  'New Lead', 'Qualified', 'Sample Sent', 'Quotation Sent', 'Negotiation',
  'Order Confirmed', 'Production', 'Ready', 'Dispatched', 'Payment Pending',
  'Completed', 'Lost',
];

// Weighted points out of 100.
function scoreLead({
  requestedQty = 0,        // kg asked for in this conversation
  ordersCount = 0,         // lifetime orders
  totalValue = 0,          // lifetime billed value
  daysSinceLastOrder = null,
  messagesIn = 0,          // how engaged they are
  quotesCount = 0,
  overdueAmount = 0,
} = {}) {
  let pts = 0;

  // Demand size — a big enquiry is the strongest single signal.
  const qty = Number(requestedQty) || 0;
  if (qty >= 1000) pts += 25; else if (qty >= 500) pts += 18; else if (qty >= 200) pts += 12; else if (qty > 0) pts += 6;

  // Proven buyer.
  const orders = Number(ordersCount) || 0;
  if (orders >= 10) pts += 20; else if (orders >= 5) pts += 15; else if (orders >= 2) pts += 10; else if (orders === 1) pts += 5;

  // Lifetime value.
  const val = Number(totalValue) || 0;
  if (val >= 2000000) pts += 20; else if (val >= 500000) pts += 14; else if (val >= 100000) pts += 8; else if (val > 0) pts += 4;

  // Recency — recent buyers are warm, long-dormant ones cool off.
  if (daysSinceLastOrder != null) {
    const d = Number(daysSinceLastOrder);
    if (d <= 30) pts += 15; else if (d <= 60) pts += 10; else if (d <= 120) pts += 5;
  }

  // Engagement + active quoting.
  const msgs = Number(messagesIn) || 0;
  if (msgs >= 10) pts += 10; else if (msgs >= 4) pts += 6; else if (msgs >= 1) pts += 3;
  if (Number(quotesCount) > 0) pts += 10;

  // Payment behaviour drags the score down.
  if (Number(overdueAmount) > 0) pts -= 15;

  pts = Math.max(0, Math.min(100, pts));
  const band = pts >= 65 ? 'HOT' : pts >= 35 ? 'WARM' : 'COLD';
  return { points: pts, score: band };
}

// §20 — is this customer overdue for a reorder, based on their own rhythm?
// Needs at least two orders to know a cadence; 1.5x their average gap is the
// trigger, so a slow buyer isn't chased like a weekly one.
function reorderDue({ avgGapDays, daysSinceLastOrder, ordersCount = 0 } = {}) {
  const gap = Number(avgGapDays), since = Number(daysSinceLastOrder);
  if (!(Number(ordersCount) >= 2) || !Number.isFinite(gap) || gap <= 0 || !Number.isFinite(since)) {
    return { due: false, reason: 'Not enough order history to judge a reorder cycle.' };
  }
  const threshold = Math.round(gap * 1.5);
  return since >= threshold
    ? { due: true, threshold, reason: `Usually orders about every ${Math.round(gap)} days; ${since} days since the last one.` }
    : { due: false, threshold, reason: `Last order ${since} days ago; typical cycle ${Math.round(gap)} days.` };
}

module.exports = { scoreLead, reorderDue, PIPELINE };
