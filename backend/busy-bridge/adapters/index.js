const { BusyXmlFileAdapter } = require('./xmlFileAdapter');
const { BusyRestAdapter } = require('./restGatewayAdapter');
const { InMemoryBusyAdapter } = require('./memoryAdapter');
const { NO_CAPABILITIES, OPERATIONS } = require('./busyAdapter');

/**
 * The single place that knows which BUSY transports exist.
 *
 * Adding a transport = one new module implementing the BusyAdapter contract,
 * one case here, and one environment variable. No dashboard logic changes.
 */
function createAdapter(config) {
  switch (config.adapter) {
    case 'xml':
      return new BusyXmlFileAdapter(config.xml);
    case 'rest':
      return new BusyRestAdapter(config.rest);
    case 'memory':
      if (config.env === 'production') {
        // A fake BUSY in production would report every dispatch as posted
        // while nothing reached the accounts. Refuse at startup.
        throw new Error(
          'BUSY_ADAPTER=memory is a test double and must not be used in production. ' +
            'Set BUSY_ADAPTER=xml (or rest) — see docs/BUSY_INTEGRATION.md.',
        );
      }
      return new InMemoryBusyAdapter();
    default:
      throw new Error(`Unknown BUSY adapter "${config.adapter}".`);
  }
}

module.exports = {
  createAdapter,
  BusyXmlFileAdapter,
  BusyRestAdapter,
  InMemoryBusyAdapter,
  NO_CAPABILITIES,
  OPERATIONS,
};
