const { loadConfig } = require('./config');
const { Bridge } = require('./bridge');
const { createBusyRoutes } = require('./routes');

/**
 * Mount the BUSY Bridge onto the dashboard's Express app.
 *
 * Called once from server.js:
 *
 *   const { mountBusyBridge } = require('./busy-bridge');
 *   const busyBridge = mountBusyBridge(app, pool, { verifyToken, requireRole });
 *
 * A misconfigured bridge must never stop the production dashboard from
 * starting — machine monitoring matters more than accounting sync — so a
 * configuration error is logged and the bridge stays down rather than
 * throwing out of server startup.
 */
function mountBusyBridge(app, pool, { verifyToken, requireRole, env = process.env, logger = console } = {}) {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    logger.error(`[BUSY] bridge NOT started — configuration error: ${err.message}`);
    return null;
  }

  let bridge;
  try {
    bridge = new Bridge(config, pool, undefined, logger);
  } catch (err) {
    logger.error(`[BUSY] bridge NOT started — ${err.message}`);
    return null;
  }

  app.use('/api/busy', createBusyRoutes(bridge, { verifyToken, requireRole }));
  bridge.start();

  logger.log(
    `[BUSY] bridge mounted at /api/busy (adapter=${config.adapter}, enabled=${config.enabled})` +
      (config.adapter === 'xml' ? ` outbox=${config.xml.outbox}` : ''),
  );
  return bridge;
}

module.exports = {
  mountBusyBridge,
  Bridge,
  createBusyRoutes,
  loadConfig,
};
