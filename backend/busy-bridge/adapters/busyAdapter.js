/**
 * THE replaceable boundary.
 *
 * Everything BUSY-specific lives behind this contract. The queue, the retry
 * engine, the mapping store, the reconciler and the routes know nothing about
 * XML, REST, SMB shares or SQL — they only know these thirteen operations.
 *
 * Swapping BUSY transports means writing one new module and changing one
 * environment variable. If a new adapter ever forces a change outside
 * busy-bridge/adapters/, the abstraction has leaked and that is the bug to fix.
 *
 * Operations an installation cannot perform MUST throw UnsupportedOperationError.
 * They must never be faked and must never quietly succeed — a fake success
 * would put a wrong reference into the dashboard and corrupt reconciliation.
 *
 * Contract (all async unless noted):
 *
 *   name                                    string, stable id used in config/logs
 *   capabilities()                          -> Capabilities  (sync, must be truthful)
 *   testConnection()                        -> { online, message, detail? }
 *   getCustomers(since?)                    -> BusyMasterRecord[]
 *   getVendors(since?)                      -> BusyMasterRecord[]
 *   getItems(since?)                        -> BusyMasterRecord[]
 *   createOrUpdateCustomer(customer, ctx)   -> BusyResult
 *   createOrUpdateVendor(vendor, ctx)       -> BusyResult
 *   createOrUpdateItem(item, ctx)           -> BusyResult
 *   sendSalesReference(doc, ctx)            -> BusyResult
 *   sendPurchaseReference(doc, ctx)         -> BusyResult
 *   sendDispatch(doc, ctx)                  -> BusyResult
 *   sendInvoice(doc, ctx)                   -> BusyResult
 *   getTransactionStatus(externalReference) -> BusyResult
 *   reconcileTransaction(externalReference) -> BusyTransactionSnapshot | null
 *   close?()                                -> void
 *
 * SendContext (built by syncService, all ids already resolved through the
 * mapping table — an adapter never resolves a DHOWN id itself):
 *   { externalReference, partyBusyId?, partyBusyCode?,
 *     itemBusyIds: { [itemDhownId]: { busyId, busyCode? } },
 *     warehouseBusyId?, attempt }
 *
 * BusyResult.status is one of:
 *   POSTED    BUSY booked it and gave us a reference
 *   ACCEPTED  handed over successfully, BUSY has not confirmed yet (async XML)
 *   DUPLICATE BUSY already holds this external reference
 *   REJECTED  BUSY refused it
 *   UNKNOWN   BUSY has never seen this reference
 */

/** Capability set with everything off — adapters spread over this. */
const NO_CAPABILITIES = {
  testConnection: false,
  getCustomers: false,
  getVendors: false,
  getItems: false,
  createOrUpdateCustomer: false,
  createOrUpdateVendor: false,
  createOrUpdateItem: false,
  sendSalesReference: false,
  sendPurchaseReference: false,
  sendDispatch: false,
  sendInvoice: false,
  getTransactionStatus: false,
  reconcileTransaction: false,
  /**
   * True when sends complete synchronously and return a BUSY reference
   * immediately. False for file-drop transports, where the reference only
   * arrives later and the queue must park the job in AWAITING_BUSY.
   */
  synchronousSend: false,
};

/** Every operation named in the contract, used by tests and the dashboard. */
const OPERATIONS = Object.keys(NO_CAPABILITIES).filter((k) => k !== 'synchronousSend');

module.exports = { NO_CAPABILITIES, OPERATIONS };
