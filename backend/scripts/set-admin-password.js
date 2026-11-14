// One-off: rotate a user's password. You supply the new password via env var,
// so it is never written into any file or committed.
//
//   Windows PowerShell:
//     $env:NEW_PASSWORD="YourStrongPassword"; node scripts/set-admin-password.js
//   optional user (defaults to admin):
//     $env:NEW_PASSWORD="..."; $env:TARGET_USER="admin"; node scripts/set-admin-password.js
//
// The password is read from the environment, hashed with bcrypt, and stored.
// Clear it from your shell afterwards:  Remove-Item Env:NEW_PASSWORD
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');

(async () => {
  const username = process.env.TARGET_USER || 'admin';
  const pw = process.env.NEW_PASSWORD;

  if (!pw || pw.length < 8) {
    console.error('Set NEW_PASSWORD (min 8 chars) in the environment first. Nothing changed.');
    process.exit(1);
  }
  if (pw === 'admin123') {
    console.error('Refusing to set the old default password. Pick a different one.');
    process.exit(1);
  }

  try {
    const hash = await bcrypt.hash(pw, 10);
    const r = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE username = $2 RETURNING id, username, role`,
      [hash, username]
    );
    if (r.rows.length === 0) {
      console.error(`No user named "${username}". Nothing changed.`);
      process.exit(1);
    }
    console.log(`Password updated for ${r.rows[0].username} (role ${r.rows[0].role}).`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
