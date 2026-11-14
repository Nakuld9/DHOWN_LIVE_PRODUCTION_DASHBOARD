// The agent fleet — wires the shared runtime together and defines the agents.
//
// Build order (blueprint §8): the shared runtime is built ONCE here; agents are
// added one at a time. This first slice ships the Production agent. Adding the next
// agent (Inventory, then Job-work, …) is: register its read tools, add a definition
// to AGENTS, done — the runtime, registry, permissioning and action log are shared.

const { createRegistry } = require('./tool-registry');
const { makeRuntime } = require('./runtime');
const makeApprovals = require('./approvals');
const model = require('./model');

// Each agent = a name, a title (used in prompts), the tools it may use, and any
// extra answer rules. An agent can only ever call tools listed here.
const AGENTS = {
  production: {
    name: 'production',
    title: 'Production (knitting) assistant',
    tools: ['get_production_summary', 'get_machine_status', 'get_production_trend', 'get_operator_output_trend'],
    keywords: /\b(produc|output|knit|roll|machine|rpm|shift|target|running|offline|stopped)/i,
    answerRules: 'Quantities in kg. For a single day use get_production_summary; for "this week / last N days / trend / by machine / which machine is best/worst" use get_production_trend, and get_operator_output_trend for per-operator output. If asked "why" output is low, use machine status to point at stopped/offline machines. Do not estimate a figure the tools did not return.',
  },
  inventory: {
    name: 'inventory',
    title: 'Inventory assistant',
    tools: ['get_stock_summary', 'get_low_stock', 'stock_transfer'],
    keywords: /\b(stock|inventory|yarn|greige|finished|kg on hand|how much.*(yarn|fabric|stock)|low.?stock|reorder|cones|available|transfer|stock.?transfer|move stock)/i,
    answerRules: 'Quantities in kg. Distinguish yarn vs greige vs finished fabric. For "what is low", list the lots from get_low_stock. To move stock between stores, use stock_transfer — it DRAFTS the transfer for a supervisor to approve; say so, never claim it is done. Do not estimate stock the tools did not return.',
  },
  quality: {
    name: 'quality',
    title: 'Quality assistant',
    tools: ['get_quality_summary', 'get_defect_pareto', 'get_reject_trend', 'hold_roll', 'open_capa'],
    keywords: /\b(quality|defect|reject|grade|4.?point|pareto|inspection|inspect|shade|failing|fail rate|hold|quarantine|capa|corrective|preventive|action item|raise a? ?(ticket|capa))/i,
    answerRules: 'Grades are A/B/REJECT from the 4-point system. For "what is failing", list defects from get_defect_pareto by points. For a reject trend / reject rate over the last N days, use get_reject_trend. Name the worst machine when asked which machine. To hold/quarantine a roll, use hold_roll; to open a corrective/preventive action ticket, use open_capa — both DRAFT for a supervisor to approve; say so, never claim it is done. Do not estimate a rate the tools did not return.',
  },
  jobwork: {
    name: 'jobwork',
    title: 'Job-work assistant',
    tools: ['get_jobwork_outstanding', 'get_jobwork_overdue', 'get_process_loss', 'create_subcontract_challan'],
    keywords: /\b(job.?work|dye.?house|dyeing|dyer|finisher|finishing|subcontract|challan|vendor|overdue|not returned|process loss|stuck|send.{0,15}(dye|finish|greige)|create a? ?challan)/i,
    answerRules: 'Quantities in kg. "At vendor" means sent on a challan and not yet returned. For "what is stuck / overdue", list from get_jobwork_overdue. Process loss = sent minus received. To send greige out to a dye house / finisher, use create_subcontract_challan — it DRAFTS the challan for a supervisor to approve; say so, never claim it is sent. Do not estimate a figure the tools did not return.',
  },
  maintenance: {
    name: 'maintenance',
    title: 'Maintenance assistant',
    tools: ['get_open_maintenance', 'get_pm_due', 'get_low_spares', 'raise_maintenance_wo'],
    keywords: /\b(mainten|breakdown|down.?time|repair|spare|preventive|pm |mttr|mtbf|overhaul|service.?due|machine.?down|not working|work.?order|raise a? ?wo|log a repair)/i,
    answerRules: 'For "what is broken / open", use get_open_maintenance. For "what is due", list from get_pm_due (flag overdue). For spares, list from get_low_spares. To raise/log a work order for a machine, use raise_maintenance_wo — it DRAFTS the WO for a supervisor to approve; say so, never claim it is created. Do not estimate a figure the tools did not return.',
  },
  costing: {
    name: 'costing',
    title: 'Costing assistant',
    tools: ['get_fabric_cost', 'get_cost_breakdown', 'get_customer_profitability'],
    keywords: /\b(cost|costing|margin|profit|overhead|per.?kg cost|selling price|variance|expensive|cheap|price per)/i,
    answerRules: 'Amounts in ₹ per kg. Cost = yarn + knitting + job charges + overhead. Report cost, selling price and margin from get_fabric_cost; the make-up from get_cost_breakdown. For "most profitable customers" use get_customer_profitability (revenue-ranked; note true product-cost contribution needs the costing link). If cost data is missing (permission or no snapshot), say so. Do not estimate a figure the tools did not return.',
  },
  purchase: {
    name: 'purchase',
    title: 'Purchase assistant',
    tools: ['get_open_purchase_orders', 'get_overdue_purchase_orders', 'create_purchase_order', 'get_supplier_intel'],
    keywords: /\b(purchase|supplier|procurement|grn|goods.?receipt|purchase.?order|\bpo\b|reorder from|buy|raise a po|order yarn|po for|buy yarn|yarn|price increase|raised price|supplier price)/i,
    answerRules: 'Amounts in ₹. For "what is open", use get_open_purchase_orders; for late suppliers, list from get_overdue_purchase_orders. To raise a PO, use create_purchase_order — it DRAFTS the PO for a supervisor to approve; say so, never claim it is placed. Do not estimate a figure the tools did not return.',
  },
  dispatch: {
    name: 'dispatch',
    title: 'Dispatch assistant',
    tools: ['get_open_sales_orders', 'get_overdue_deliveries', 'get_recent_dispatches'],
    keywords: /\b(dispatch|despatch|ship|shipment|deliver|delivery|sales.?order|pending.?order|ready to ship|to ship|customer order)/i,
    answerRules: 'Quantities in kg, amounts in ₹. For "what is pending/late to ship", use get_open_sales_orders and get_overdue_deliveries. For "what shipped", use get_recent_dispatches. Do not estimate a figure the tools did not return.',
  },
  sales: {
    name: 'sales',
    title: 'Sales (customer follow-up) assistant',
    tools: ['get_open_followups', 'create_followup'],
    keywords: /\b(follow.?up|follow up with|remind|reminder|call.{0,12}customer|chase|lead|enquiry|quotation follow|call back|touch base|check with)/i,
    answerRules: 'For "what is pending / due", list from get_open_followups (flag overdue). To set a follow-up/reminder for a customer, use create_followup — it DRAFTS the follow-up for a supervisor to approve; say so, never claim it is set. Do not invent customers or dates the tools did not return.',
  },
  // Analytics — trends over time from the nightly warehouse rollup (dw_* tables).
  // Answers "this week / last N days / trend / by machine / who owes us" without
  // scanning raw transactions. Read-only; receivables is gated SUPERVISOR+ inside
  // the tool, so an operator asking for aging simply gets no financial figures.
  analytics: {
    name: 'analytics',
    title: 'Analytics & trends assistant',
    maxCalls: 4,
    tools: [
      'get_production_trend', 'get_operator_output_trend',
      'get_reject_trend', 'get_yarn_flow_trend', 'get_receivables_aging',
      'get_import_shortage',
    ],
    keywords: /\b(trend|this week|last\s*\d*\s*(day|week|month)|over time|per day|by machine|which machine|best machine|worst machine|underperform|top operator|who owes|receivable|aging|ageing|outstanding.*(customer|overdue)|consumed|history of|compared? to|shortage|run out|stock out|import.*(arriv|eta|shortage))/i,
    answerRules: 'Figures come from the daily rollup (dw_* tables). Quantities in kg, money in ₹. State the window (e.g. "last 7 days"). For "which machine is underperforming" name the worst machine from get_production_trend. Receivables aging is INTERNAL management data — never say it would be quoted to a customer. If a tool returns note:"no data" or an empty list, say so plainly rather than guessing.',
  },

  // AI Accountant — day-to-day finance. It reports the financial picture from MES
  // data and can DRAFT a Busy purchase voucher, but only through the approvals
  // queue — it never posts to the books itself. Every figure it states must carry
  // the tag the tool returned (actual/estimate/unavailable); anything that lives
  // only in Busy is reported as "not available in the MES — it's in Busy", NEVER a
  // made-up number. Financial tools are SUPERVISOR+, so an operator asking gets no
  // figures rather than a leak.
  accountant: {
    name: 'accountant',
    title: 'AI Accountant',
    maxCalls: 5,
    tools: [
      'get_cash_position', 'get_receivables', 'get_payables',
      'get_sales_summary', 'get_purchase_summary', 'get_gst_summary', 'get_finance_snapshot',
      'get_anomalies', 'get_finance_report',
      'get_cashflow_forecast', 'get_working_capital', 'get_customer_profitability',
      'get_tds_monitor',
      'draft_purchase_voucher',
    ],
    keywords: /\b(cash position|cash flow|receivable|payable|owe|owes|outstanding|overdue|collection|collect|invoice|sales today|purchase|gst|tax liability|itc|ledger|balance|due (today|this week)|working capital|finance|accounts?|duplicate|anomal|unusual|suspicious|backdated|finance report|needs attention|tds|194c|statutory)\b/i,
    answerRules: 'You are an assistant, not the statutory accountant (spec §33). Amounts in ₹. State value, period and source. Use ONLY tool results. CRITICAL (spec §32): never invent a balance — if a figure comes back {available:false} or unavailable, say plainly "that is in Busy, not the MES" and do not estimate it. Label ACTUAL vs ESTIMATE vs UNAVAILABLE exactly as the tools do. To prepare a purchase voucher use draft_purchase_voucher — it only DRAFTS for approval and never posts to Busy; say the draft awaits approval, never that it is posted. For tax/GST treatment or statutory positions, recommend review by the company CA — do not present tax conclusions as certain.',
  },

  // AI CFO — management-level financial reasoning (spec §18). Same read tools plus
  // trends/margin, higher call budget to compose a picture. Still read-only; shows
  // the underlying numbers behind any conclusion and honours the same honesty rules.
  cfo: {
    name: 'cfo',
    title: 'AI CFO',
    maxCalls: 7,
    tools: [
      'get_finance_snapshot', 'get_receivables', 'get_payables',
      'get_sales_summary', 'get_purchase_summary', 'get_gst_summary', 'get_anomalies',
      'get_customer_profitability', 'get_cashflow_forecast', 'get_working_capital',
      'get_production_trend', 'get_reject_trend', 'get_fabric_cost',
    ],
    keywords: /\b(cfo|ebitda|profitab|margin|why did .* (fall|drop|rise|grow)|segment|blocked|working capital|scenario|what if|forecast|compare .* (month|quarter|year)|where is (cash|money)|liquidity|funding gap)\b/i,
    answerRules: 'Management financial analysis. Explain the reasoning and SHOW the underlying numbers from the tools. Amounts in ₹. Distinguish ACTUAL / CALCULATED / ESTIMATE / RECOMMENDATION (spec §32). Never invent figures; if inputs are unavailable (in Busy, or not yet captured), say what is missing and give only what the data supports. For statutory/tax matters defer to the company CA.',
  },

  // Management is the composer — read-only across the whole fleet's tools, no new
  // ones. It is granted every read tool (including cost, which the registry still
  // gates to SUPERVISOR+ by the CALLER's role, so an operator asking for a brief
  // simply gets no cost figures). Higher call budget so a brief can pull several
  // domains in one turn.
  management: {
    name: 'management',
    title: 'Management brief assistant',
    maxCalls: 6,
    tools: [
      'get_production_summary', 'get_machine_status',
      'get_stock_summary', 'get_low_stock',
      'get_quality_summary', 'get_jobwork_outstanding', 'get_jobwork_overdue',
      'get_open_maintenance', 'get_open_purchase_orders',
      'get_open_sales_orders', 'get_overdue_deliveries', 'get_recent_dispatches',
      'get_open_followups', 'get_fabric_cost',
      'get_production_trend', 'get_reject_trend', 'get_receivables_aging', 'get_import_shortage',
    ],
    keywords: /\b(how did we do|how are we doing|overview|summary|brief|overall|management|business|weekly|this week|company|how.?s the (mill|factory|business))/i,
    answerRules: 'Compose a SHORT executive brief in a few bullet points across the domains the tools return (output, machines, stock, quality, job-work, orders/dispatch, and cost/margin if permitted). Lead with what needs attention. Use ONLY tool results; if a domain returned nothing, say "no data" for it rather than guessing.',
  },
};

// Route a free-text question to an agent by SCORING keyword hits — the agent whose
// keywords match the most wins, so an overlapping word (e.g. "machine", shared by
// production and quality) does not misroute a "reject rate on which machine"
// question. Ties keep the earlier (more common) agent. Defaults to production.
function pickAgent(question) {
  const q = question || '';
  let best = null, bestScore = 0;
  for (const a of Object.values(AGENTS)) {
    if (!a.keywords) continue;
    const hits = (q.match(new RegExp(a.keywords.source, 'gi')) || []).length;
    if (hits > bestScore) { bestScore = hits; best = a; }
  }
  return best || AGENTS.production;
}

function buildFleet({ pool }) {
  const registry = createRegistry();
  require('./tools/production.tools')(registry, { pool });
  require('./tools/inventory.tools')(registry, { pool });
  require('./tools/quality.tools')(registry, { pool });
  require('./tools/jobwork.tools')(registry, { pool });
  require('./tools/maintenance.tools')(registry, { pool });
  require('./tools/costing.tools')(registry, { pool });
  require('./tools/purchase.tools')(registry, { pool });
  require('./tools/dispatch.tools')(registry, { pool });
  require('./tools/sales.tools')(registry, { pool });
  require('./tools/trends.tools')(registry, { pool });
  require('./tools/finance.tools')(registry, { pool });
  require('./tools/voucher.tools')(registry, { pool });

  const approvals = makeApprovals({ pool, registry });
  const runtime = makeRuntime({ registry, chat: model.chat, pool, approvals });

  async function ask({ question, user, agentName }) {
    const agent = agentName ? AGENTS[agentName] : pickAgent(question);
    if (!agent) return { error: 'No agent for that question' };
    return runtime.run({ agent, question, user });
  }

  return { ask, registry, approvals, agents: AGENTS };
}

module.exports = { buildFleet, AGENTS, pickAgent };
