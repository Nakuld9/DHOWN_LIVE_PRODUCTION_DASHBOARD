// Customer complaints.
//
// The value of recording complaints is not the record — it is being able to
// answer "how often does this happen, and with what". So the things asserted
// here are the ones that make the data trustworthy enough to draw that
// conclusion from: a complaint cannot be resolved without saying how, the
// status cannot skip states, and the event trail cannot be quietly rewritten.
//
//   node tests/complaints.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const complaints = require('../src/lib/complaints')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZCMP' + Date.now().toString().slice(-6);
let pid;

(async () => {
  pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ Complaint Test') RETURNING partner_id`,
    [TAG])).rows[0].partner_id;

  try {
    console.log('\nLogging one');
    const bad = await complaints.create({ partner_id: pid }, { by: 'test' });
    ok(bad.code === 400, 'a complaint with no summary is refused', bad.error);
    ok((await complaints.create({ summary: 'x' }, { by: 'test' })).code === 400,
      'and one with no customer');
    ok((await complaints.create({ partner_id: pid, summary: 'x', category: 'NONSENSE' }, {})).code === 400,
      'an invented category is refused');

    // A customer rarely knows the dispatch number when they ring. Refusing to
    // record the complaint until they do is how complaints go unrecorded.
    const c = await complaints.create({
      partner_id: pid, summary: 'Barre visible across the roll face',
      detail: 'Two rolls from the last lot show horizontal banding.',
      category: 'QUALITY', severity: 'HIGH', source: 'PHONE',
    }, { by: 'test' });
    ok(c.ok === true, 'a complaint with no document links is accepted', c.error || '');
    const id = c.complaint.complaint_id;
    ok(/^CMP-\d{4}-\d{3}$/.test(c.complaint.complaint_no), 'it gets a readable number', c.complaint.complaint_no);
    ok(c.complaint.status === 'OPEN', 'and starts OPEN');

    // Severity drives the SLA, because a critical fault on a running order
    // cannot wait a week.
    const due = new Date(c.complaint.due_date);
    const days = Math.round((due - new Date(c.complaint.raised_on)) / 86400000);
    ok(days === 3, 'a HIGH complaint is due in 3 days', `${days} days`);

    console.log('\nThe state machine holds');
    const skip = await complaints.transition(id, 'CLOSED', { by: 'test' });
    ok(skip.code === 409, 'an open complaint cannot jump straight to CLOSED', skip.error);

    const noHow = await complaints.transition(id, 'RESOLVED', { by: 'test' });
    ok(noHow.code === 400, 'resolving without a resolution type is refused', noHow.error);

    const noNote = await complaints.transition(id, 'RESOLVED',
      { by: 'test', resolution_type: 'CREDIT_NOTE' });
    ok(noNote.code === 400, 'and without saying what was done', noNote.error);

    ok((await complaints.transition(id, 'INVESTIGATING', { by: 'test', note: 'Pulled the lot' })).ok === true,
      'OPEN -> INVESTIGATING is allowed');

    const res = await complaints.transition(id, 'RESOLVED', {
      by: 'test', resolution_type: 'CREDIT_NOTE',
      resolution: 'Credit note raised for the two rolls',
      root_cause: 'Yarn lot mixed across creel',
    });
    ok(res.ok === true, 'and resolving with a reason works');
    ok(res.complaint.resolved_at !== null, 'resolved_at is stamped');
    ok(res.complaint.resolved_by === 'test', 'with who did it');

    ok((await complaints.transition(id, 'CLOSED', { by: 'test' })).ok === true, 'RESOLVED -> CLOSED');
    const afterClose = await complaints.transition(id, 'OPEN', { by: 'test' });
    ok(afterClose.code === 409, 'a closed complaint cannot be reopened — raise a new one', afterClose.error);

    console.log('\nThe trail records what happened');
    const full = await complaints.get(id);
    ok(full.events.length >= 4, 'every transition left an event', `${full.events.length} events`);
    const statuses = full.events.filter(e => e.kind === 'STATUS').map(e => e.to_status);
    ok(statuses.join('>') === 'OPEN>INVESTIGATING>RESOLVED>CLOSED',
      'and they read as the actual history', statuses.join(' > '));
    ok(full.events.some(e => e.note && /credit note raised/i.test(e.note)),
      'including what was done about it');
    ok(full.allowed_transitions.length === 0, 'a closed complaint offers no next step');

    console.log('\nNotes and assignment');
    const c2 = await complaints.create({
      partner_id: pid, summary: 'Short by 12 kg on last dispatch', category: 'SHORTAGE',
    }, { by: 'test' });
    const id2 = c2.complaint.complaint_id;
    ok((await complaints.addNote(id2, { note: 'Weighbridge slip requested', by: 'test' })).ok === true,
      'a note can be added');
    ok((await complaints.addNote(id2, { by: 'test' })).code === 400, 'an empty note is refused');
    ok((await complaints.assign(id2, 'rishu', { by: 'test' })).ok === true, 'it can be assigned');
    const got2 = await complaints.get(id2);
    ok(got2.assigned_to === 'rishu', 'and the assignment sticks');
    ok(got2.events.some(e => e.kind === 'ASSIGN'), 'assignment is in the trail too');
    ok(got2.severity === 'MEDIUM' && got2.category === 'SHORTAGE', 'defaults applied where not given');

    console.log('\nThe worklist puts what matters first');
    const open = await complaints.list({ status: 'OPEN' });
    ok(open.some(x => x.complaint_id === id2), 'an open complaint is listed');
    ok(!open.some(x => x.complaint_id === id), 'a closed one is not');

    // Backdate it past its SLA to prove the overdue filter works.
    await pool.query(`UPDATE complaints SET due_date = CURRENT_DATE - 2 WHERE complaint_id=$1`, [id2]);
    const late = await complaints.list({ overdue: true });
    ok(late.some(x => x.complaint_id === id2), 'an overdue one shows in the overdue filter');
    ok(late.every(x => x.overdue === true), 'and everything in it really is overdue');

    console.log('\nThe pattern is what this is for');
    const s = await complaints.stats({});
    ok(s.totals.total >= 2, 'complaints are counted', `${s.totals.total}`);
    ok(s.totals.overdue >= 1, 'overdue is counted separately', `${s.totals.overdue}`);
    ok(s.by_category.some(x => x.category === 'QUALITY'),
      'and grouped by category — one is an incident, twenty is a process problem');
    ok(s.top_customers.some(x => x.partner_id === pid), 'and by customer');
    ok(typeof s.totals.avg_days_to_resolve === 'number', 'average time to resolve is measured',
      String(s.totals.avg_days_to_resolve));

    console.log('\nThe database enforces the vocabulary too');
    // Not just the service layer — a direct write must fail as well.
    let direct = null;
    try {
      await pool.query(
        `INSERT INTO complaints (complaint_no, partner_id, summary, status)
         VALUES ($1,$2,'bypass','INVENTED')`, [TAG + '-X', pid]);
    } catch (e) { direct = e; }
    ok(direct && direct.code === '23514', 'an invented status is rejected by the database',
      direct ? direct.code : 'ACCEPTED');

  } finally {
    await pool.query(
      `DELETE FROM complaint_events WHERE complaint_id IN (SELECT complaint_id FROM complaints WHERE partner_id=$1)`,
      [pid]).catch(() => {});
    await pool.query(`DELETE FROM complaints WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
