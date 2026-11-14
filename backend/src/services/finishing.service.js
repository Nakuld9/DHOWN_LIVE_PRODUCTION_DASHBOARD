// Finishing service — list + QC save, with realtime dashboard emit.
module.exports = (repo, { io }) => ({
  async list() { return (await repo.listReceipts()).rows; },

  async saveQC(receipt_id, body, username) {
    const result = await repo.saveQC(receipt_id, body, username);
    io.emit('inventory:dashboard_update', { type: 'finishing_record' });
    return result.row;
  },
});
