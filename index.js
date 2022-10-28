const { ProviderStore } = require('./src/provider-store')
const { ProxyBuilder } = require('./src/proxy-builder')
const dnsCache = require('./src/utils/dns-cache')
const { setDebug } = require('./src/utils/debug-helper')

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
 * @param {Object} options - Package options (optional):
 *      {
 *          connectionParams: {
 *              timeout: 5000,                  // milliseconds
 *              throttleLimit: 2,
 *              throttleSlotInterval: 10
 *          },
 *          pingerParams: {
 *              interval: 10,                   // seconds
 *              timeout: 10,                    // seconds
 *              maxFails: 3,                    // max consecutive fails to consider an RPC down
 *              minSuccesses: 5,                // min consecutive successes to consider an RPC back up
 *              maxInterBlockInterval: 30       // seconds (used to detect stuck/failed RPC)
 *          }
 *          providerPickAlgorithm: 'primary'    // primary | round-robin
 *          dnsCacheEnabled: true
 *          dnsCacheTTL: 7200,                  // seconds
 *          maxFailsPerCall: 2
 *          debug: false,                       // enable/disable more verbose debug logs
 *      }
 */
function init (providersConfig, options = {
    connectionParams: {},
    pingerParams: {},
    providerPickAlgorithm: 'primary',
    dnsCacheEnabled: true, 
    dnsCacheTTL: null,
    maxFailsPerCall: null,
    debug: false
}) {
    setDebug(options.debug)

    // enable DNS lookup caching for RPC provider hostnames
    if (options.dnsCacheEnabled) dnsCache.init(providersConfig, options.dnsCacheTTL)

    providerStore = new ProviderStore(providersConfig, options.connectionParams, options.pingerParams, options.providerPickAlgorithm)
    proxyBuilder = new ProxyBuilder(providerStore, options.maxFailsPerCall)
}

function getProvider(networkName) {
    if (! providerStore || ! providerStore.isInitialized()) throw new Error('Provider store not initialized')

    return proxyBuilder.buildProxy(networkName)
}

module.exports = { init, getProvider }
