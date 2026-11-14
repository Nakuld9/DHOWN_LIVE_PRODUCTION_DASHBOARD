// Backup repository — filesystem + pg_dump operations for DB backups.
// Behaviour verbatim from the original inline /api/backup + /api/admin/backup(s).
// BACKUP_DIR is computed to backend/backups (same as server.js path.join(__dirname,'backups')).
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const tenant = require('../../config/tenant');

// One directory, from tenant config. This was previously two: the listing read
// backend/backups while createDump wrote to a hardcoded absolute path, so an
// on-demand dump never appeared in the list of backups. A second instance would
// also have written its dumps into Dhown's folder under a dhown_mes_ name.
const BACKUP_DIR = tenant.backupDir;

module.exports = ({ PG_BIN }) => ({
  BACKUP_DIR,

  // On-demand pg_dump (-F c custom format) into this instance's backup dir.
  createDump() {
    return new Promise((resolve, reject) => {
      try {
        const backupDir = BACKUP_DIR;
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${tenant.backupPrefix}_${ts}.dump`;
        const fullPath = path.join(backupDir, filename);
        const pgDump = `"${PG_BIN}\\pg_dump.exe"`;
        const cmd = `${pgDump} -U ${process.env.DB_USER || 'postgres'} -F c -f "${fullPath}" ${process.env.DB_NAME || 'dhown_mes'}`;
        const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };
        exec(cmd, { env }, (error) => {
          if (error) return reject(new Error('Backup failed: ' + error.message));
          resolve({ filename, path: fullPath });
        });
      } catch (err) { reject(err); }
    });
  },

  // Daily-backup .sql filenames, newest first (for the admin trigger response).
  listSqlNames() {
    return fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sql')).sort().reverse()
      : [];
  },

  // Daily-backup .sql files with size + mtime, newest first.
  listSqlDetailed() {
    return fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR)
          .filter(f => f.endsWith('.sql'))
          .map(f => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { name: f, size_kb: Math.round(stat.size / 1024), created_at: stat.mtime };
          })
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      : [];
  },
});
