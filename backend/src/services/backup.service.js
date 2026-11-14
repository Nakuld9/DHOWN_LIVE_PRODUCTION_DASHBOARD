// Backup service — on-demand dump, daily-backup trigger, and listing.
// runDailyBackup is injected from server.js (it owns the scheduler + retention).
module.exports = (repo, { runDailyBackup }) => ({
  async createDump() {
    return repo.createDump();
  },

  async triggerDaily() {
    await runDailyBackup();
    return { success: true, message: 'Backup created successfully', backups: repo.listSqlNames() };
  },

  listBackups() {
    return repo.listSqlDetailed();
  },
});
