// Settings controller — HTTP req/res. Response shapes and error handling preserved
// verbatim from the original inline handlers in server.js.
module.exports = (service) => ({
  async get(req, res) {
    try {
      const settings = await service.getAll();
      res.json(settings);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },

  async update(req, res) {
    try {
      const result = await service.saveAll(req.body);
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },
});
