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
 * @param {Object} options - Package options (optional):
 *      {
 *          connectionParams: {
 *              timeout: 5000,                  // milliseconds
 *              throttleLimit: 2,
 *              throttleSlotInterval: 10
 *          },
 *          providerPickAlgorithm: 'primary'    // primary | round-robin
 *          dnsCacheEnabled: true
 *          dnsCacheTTL: 7200,                  // seconds
 *          maxFailsPerCall: 2
 *      }
 */
function init (providersConfig, options = { 
    connectionParams: {},
    providerPickAlgorithm: 'primary',
    dnsCacheEnabled: true, 
    dnsCacheTTL: null,
    maxFailsPerCall: null
}) {
    // enable DNS lookup caching for RPC provider hostnames
    if (options.dnsCacheEnabled) dnsCache.init(providersConfig, options.dnsCacheTTL)

    providerStore = new ProviderStore(providersConfig, options.connectionParams, options.providerPickAlgorithm)
    proxyBuilder = new ProxyBuilder(providerStore, options.maxFailsPerCall)
}

function getProvider(networkName) {
    if (! providerStore || ! providerStore.isInitialized()) throw new Error('Provider store not initialized')

    return proxyBuilder.buildProxy(networkName)
}

module.exports = { init, getProvider }
