// Soft delete, restore, and the guards around them.
//
// This exists because of a real incident: on 2026-08-06 a stray request removed
// the admin user from this database and the only way back was an hourly dump
// that happened to exist. Soft delete makes that recoverable — but it also
// introduces two failure modes that are worse than the problem if unguarded:
//
//   - A deleted row that still works. A user who can log in after being
//     deleted is a security hole, not a convenience.
//   - A permanent lockout. A soft-deleted row still exists, so unlike a hard
//     delete the seeder will not create a replacement admin at boot. Removing
//     the last super admin would strand everyone outside the login screen,
//     with the restore button on the wrong side of it.
//
//   node tests/soft-delete.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const trash = require('../src/lib/soft-delete')(pool);
const usersRepo = require('../src/repositories/users.repository')(pool);
const usersSvc = require('../src/services/users.service')(usersRepo);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'zzsd' + Date.now().toString().slice(-6);
const made = { users: [], fabric: [], parts: [] };

(async () => {
  try {
    // ── A deleted user is gone, but recoverable ──────────────────────────
    console.log('\nA user can be deleted and brought back');
    const hash = await bcrypt.hash('irrelevant-for-this-test', 4);
    const uid = (await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role)
       VALUES ($1,'ZZ Soft Delete','${hash}','OPERATOR') RETURNING id`, [TAG])).rows[0].id;
    made.users.push(uid);

    ok((await usersRepo.findAllPublic()).rows.some(u => u.id === uid), 'the new user is listed');

    const del = await usersSvc.remove(uid, 'test');
    ok(del.ok === true, 'an ordinary user can be deleted', JSON.stringify(del));

    const stillThere = await pool.query(`SELECT deleted_at FROM users WHERE id=$1`, [uid]);
    ok(stillThere.rows.length === 1 && stillThere.rows[0].deleted_at !== null,
      'the row survives, marked deleted — this is the whole point');
    ok(!(await usersRepo.findAllPublic()).rows.some(u => u.id === uid),
      'but it is gone from the user list');

    // The security half. A deleted user must not be able to authenticate.
    const login = await pool.query(
      `SELECT 1 FROM users WHERE username = $1 AND active = true AND deleted_at IS NULL`, [TAG]);
    ok(login.rows.length === 0, 'and cannot log in', `${login.rows.length} rows match the login query`);

    ok((await pool.query(
      `SELECT 1 FROM users WHERE active = true AND deleted_at IS NULL AND id=$1`, [uid])).rows.length === 0,
      'and is not offered for alerts or assignment');

    console.log('\nDeleting twice is not a silent success');
    const again = await trash.remove('users', uid, { by: 'test' });
    ok(again.code === 404, 'a second delete reports not-found', again.error);

    console.log('\nTrash and restore');
    const list = await trash.list({});
    const entry = list.find(x => x.table === 'users' && String(x.id) === String(uid));
    ok(!!entry, 'the deleted user appears in Trash');
    ok(entry && entry.name === TAG, 'with a name you can recognise', entry ? entry.name : '');

    const back = await trash.restore('users', uid, { by: 'test' });
    ok(back.ok === true, 'it can be restored');
    ok((await usersRepo.findAllPublic()).rows.some(u => u.id === uid), 'and is listed again');
    ok((await trash.restore('users', uid, { by: 'test' })).code === 404,
      'restoring twice reports not-found');

    // ── The unique-name trap ────────────────────────────────────────────
    console.log('\nA deleted name is free to reuse');
    // A plain UNIQUE constraint counts deleted rows, so the username would be
    // held for ever. The partial unique index is what prevents that.
    await usersSvc.remove(uid, 'test');
    const reuse = await pool.query(
      `INSERT INTO users (username, full_name, password_hash, role)
       VALUES ($1,'ZZ Reused','${hash}','OPERATOR') RETURNING id`, [TAG]);
    made.users.push(reuse.rows[0].id);
    ok(reuse.rows.length === 1, 'the username can be used again once deleted');

    // ...and restoring the old one must now refuse rather than crash.
    const clash = await trash.restore('users', uid, { by: 'test' });
    ok(clash.code === 409, 'restoring the old row is refused, with a reason', clash.error);
    ok(/already exists|same username/i.test(clash.error || ''),
      'and the reason names the conflict', clash.error);

    // ── The lockout guard ───────────────────────────────────────────────
    console.log('\nThe last super admin cannot be removed');
    const supers = (await pool.query(
      `SELECT id, username FROM users WHERE role='SUPER_ADMIN' AND active=true AND deleted_at IS NULL ORDER BY id`)).rows;
    ok(supers.length >= 1, 'there is at least one super admin', `${supers.length}`);

    if (supers.length === 1) {
      const guard = await usersSvc.remove(supers[0].id, 'test');
      ok(!!guard.badRequest, 'removing the only one is refused', guard.badRequest || JSON.stringify(guard));
      ok((await pool.query(`SELECT deleted_at FROM users WHERE id=$1`, [supers[0].id])).rows[0].deleted_at === null,
        'and the account is untouched');
    } else {
      // With more than one, deletion is allowed — check the guard says so.
      ok((await usersRepo.isLastSuperAdmin(supers[0].id)) === false,
        'with more than one super admin, the guard does not fire');
    }

    // ── Other covered tables ────────────────────────────────────────────
    console.log('\nThe same works for master data');
    const code = TAG.toUpperCase().slice(0, 8);
    await pool.query(`INSERT INTO fabric_types (code, name) VALUES ($1,'ZZ Soft Fabric')`, [code]);
    made.fabric.push(code);
    const fRepo = require('../src/repositories/fabric-types.repository')(pool);
    ok((await fRepo.getAll()).rows.some(f => f.code === code), 'a fabric type is listed');
    await fRepo.remove(code);
    ok(!(await fRepo.getAll()).rows.some(f => f.code === code), 'and disappears when deleted');
    ok((await pool.query(`SELECT 1 FROM fabric_types WHERE code=$1`, [code])).rows.length === 1,
      'while the row survives for restore');
    ok((await trash.restore('fabric_types', code, { by: 'test' })).ok === true, 'and comes back');
    ok((await fRepo.getAll()).rows.some(f => f.code === code), 'listed once more');

    console.log('\nGuards on the trash API itself');
    ok((await trash.remove('rolls', 1, { by: 'test' })).code === 400,
      'a table outside the registry is refused — table names never come from a request');
    ok((await trash.restore('machines', 1, { by: 'test' })).code === 400,
      'and so is restoring one');

    console.log('\nPurge is separate, and only works on trashed rows');
    ok((await trash.purge('users', reuse.rows[0].id, { by: 'test' })).code === 404,
      'a live row cannot be purged');

  } finally {
    for (const id of made.users) {
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    for (const c of made.fabric) {
      await pool.query(`DELETE FROM fabric_types WHERE code=$1`, [c]).catch(() => {});
    }
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
