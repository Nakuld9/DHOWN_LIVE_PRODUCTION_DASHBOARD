// Active-operators service.
module.exports = (repo) => ({
  async list() { return (await repo.listActive()).rows; },
});
