const { ProviderStore } = require('./provider-store')
const { ProxyBuilder } = require('./proxy-builder')
const dnslookup = require('./utils/dnslookup')
const redis = require("redis")

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const redisClient = redis.createClient(redisUrl);

let providerStore
let proxyBuilder

/**
 * Initialize package
 *
 * @param {Object} _providersConfig - Providers configuration object in the form of:
 *      {
 *          network_name_A: {
 *              RPCs: [
 *                  { url: 'https://rpc1-hostname/...', tags: [] },
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
 *          connectionParams: {timeout: 5000, throttleLimit: 2, throttleSlotInterval: 10},
 *          dnsCacheTTL: 7200,
 *          maxFailsPerCall: 2
 *      }
 */
function init (_providersConfig, _options = {}) {
    _connectionParams = _options['connectionParams'] ?? {}
    _dnsCacheTTL = _options['dnsCacheTTL'] ?? null
    _maxFailsPerCall = _options['maxFailsPerCall'] ?? null

    // enable DNS lookup caching for RPC provider hostnames
    dnslookup.init(_providersConfig, _dnsCacheTTL)

    providerStore = new ProviderStore(redisClient, _providersConfig, _connectionParams)
    proxyBuilder = new ProxyBuilder(providerStore, _maxFailsPerCall)

    //.: Activate "notify-keyspace-events" for expired type events
    redisClient.send_command('config', ['set','notify-keyspace-events','Ex'], SubscribeExpired)

    //.: Subscribe to the "notify-keyspace-events" channel used for expired type events
    function SubscribeExpired(err, reply) {
        if (err) {
            console.log(`[Redis] Subscribe error: ${err}`)
            return
        }

        const redisClientSub = redis.createClient(redisUrl);
        const expired_subKey = '__keyevent@0__:expired'

        redisClientSub.subscribe(expired_subKey, function() {
            console.log(`[Redis] Subscribed to ${expired_subKey} event channel: ${reply}`)
            redisClientSub.on('message', function (chan, msg) {
                if (! msg.includes('_split_key_here_')) {
                    return
                }

                const network = msg.split('_split_key_here_')[0]
                const url = msg.split('_split_key_here_')[1]
                console.log(`[Redis] Expired low-rating key. Network: ${network} Provider: ${url}`)

                providerStore.resetProviderRating(network, url)
            })
        })
    }
}

function getProvider(networkName) {
    if (! providerStore.isInitialized()) throw new Error('CustomRPC error. Provider store not initialized')

    return proxyBuilder.buildProxy(networkName)
}

module.exports = { init, getProvider }
