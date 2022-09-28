const { ProviderStore } = require('./src/provider-store')
const { ProxyBuilder } = require('./src/proxy-builder')
const dnsCache = require('./src/utils/dns-cache')

let providerStore
let proxyBuilder

/**
 * Initialize package
 *
 * @param {Object} _providersConfig - Providers configuration object in the form of:
 *      {
 *          network_name_A: {
 *              RPCs: [
 *                  { url: 'https://rpc1-hostname/...', tags: ['eth_sendRawTransaction'] },
 *                  { url: 'wss://rpc2-hostname/...', tags: ['getLogs','eth_getLogs'] },
 *                  ...
 *              ],
 *              chainId: 99999
 *          },
 *          network_name_B: {
 *              ...
 *          }
 *      }
 * @param {Object} _options - Package options (optional):
 *      {
 *          connectionParams: {
 *              timeout: 5000,              // milliseconds
 *              throttleLimit: 2,
 *              throttleSlotInterval: 10
 *          },
 *          lowRatingExpiry: 300,           // seconds
 *          dnsCacheTTL: 7200,              // seconds
 *          maxFailsPerCall: 2
 *      }
 */
function init (_providersConfig, _options = {}) {
    _connectionParams = _options['connectionParams'] ?? {}
    _lowRatingExpiry = _options['lowRatingExpiry'] ?? null
    _dnsCacheTTL = _options['dnsCacheTTL'] ?? null
    _maxFailsPerCall = _options['maxFailsPerCall'] ?? null

    // enable DNS lookup caching for RPC provider hostnames
    dnsCache.init(_providersConfig, _dnsCacheTTL)

    providerStore = new ProviderStore(_providersConfig, _connectionParams, _lowRatingExpiry)
    proxyBuilder = new ProxyBuilder(providerStore, _maxFailsPerCall)
}

function getProvider(networkName) {
    if (! providerStore || ! providerStore.isInitialized()) throw new Error('Provider store not initialized')

    return proxyBuilder.buildProxy(networkName)
}

module.exports = { init, getProvider }
