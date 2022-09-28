const { StaticJsonRpcProvider } = require('ethers').providers
const { MyWebSocketProvider } = require('./providers/websocket-provider')
const redis = require("redis")

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const redisClient = redis.createClient(redisUrl);

const REDIS_KEY_DELIMETER = '_KEY_DELIMETER_'

const defaultRating = 100
const defaultConnectionParams = {timeout: 5000, throttleLimit: 2, throttleSlotInterval: 10}
const defaultLowRatingExpiry = 60 * 5 // seconds

class ProviderStore {
    byNetwork = {}
    byNetworkCounter = {}
    byNetworkLatestBlock = {}
    connectionParams = {}
    lowRatingExpiry = null

    /**
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
     * @param {Object} _connectionParams - Provider connection parameters (optional):
     *      {
     *          timeout: 5000,              // milliseconds
     *          throttleLimit: 2,
     *          throttleSlotInterval: 10
     *      }
     * @param {number} _lowRatingExpiry - Low-rating keys expiry time (in seconds) in Redis
     */
    constructor(_providersConfig, _connectionParams = {}, _lowRatingExpiry = null) {
        // override default params if provided as input
        this.connectionParams = Object.assign(defaultConnectionParams, _connectionParams);
        this.lowRatingExpiry = _lowRatingExpiry === null ? defaultLowRatingExpiry : parseInt(_lowRatingExpiry)

        for (const network in _providersConfig) {
            const chainId = _providersConfig[network]['chainId']

            this.byNetwork[network] = []
            this.byNetworkCounter[network] = 0
            this.byNetworkLatestBlock[network] = 0

            for (let providerInfo of _providersConfig[network]['RPCs']) {
                const providerUrl = providerInfo['url']
                const provider = this.connect(providerUrl, network, chainId)

                this.byNetwork[network].push({
                    url: providerUrl,
                    provider: provider,
                    tags: providerInfo['tags'],
                    chainId: chainId,
                    rating: defaultRating
                })

                // this is async, will not load immediatelly.
                // If there is a cached rating for the provider, set it
                redisClient.get(getRatingKey(network, providerUrl), (err, value) => {
                    if (!value) return

                    this.byNetwork[network].filter(info => info.url == providerUrl)[0].rating = value
                })

                provider.on('block', async (blockNum) => {
                    if (blockNum <= this.byNetworkLatestBlock[network]) return

                    this.byNetworkLatestBlock[network] = blockNum
                    provider.emit('latest-block', blockNum)
                })
            }
        }

        // subscribe to Redis events for expiring keys
        this.redisSubscribe()
    }

    redisSubscribe() {
        //.: Subscribe to the "notify-keyspace-events" channel used for expired type events
        const subscribeExpired = (err, reply) => {
            if (err) {
                throw new Error(`Redis subscribe error: ${JSON.stringify(err)}`)
            }

            const redisClientSub = redis.createClient(redisUrl);
            const expired_subKey = '__keyevent@0__:expired'

            redisClientSub.subscribe(expired_subKey, () => {
                console.log(`[Redis] Subscribed to ${expired_subKey} event channel: ${reply}`)
                redisClientSub.on('message', (chan, msg) => {
                    if (! msg.includes(REDIS_KEY_DELIMETER)) {
                        return
                    }

                    const network = msg.split(REDIS_KEY_DELIMETER)[0]
                    const url = msg.split(REDIS_KEY_DELIMETER)[1]
                    console.log(`[Redis] Expired low-rating key. Network: ${network} Provider: ${url}`)

                    this.resetProviderRating(network, url)
                })
            })
        }

        //.: Activate "notify-keyspace-events" for expired type events
        redisClient.send_command('config', ['set','notify-keyspace-events','Ex'], subscribeExpired)
    }

    isInitialized() {
        return (Object.keys(this.byNetwork).length > 0)
    }

    getByNetwork(network) {
        const networkConfigs = this.byNetwork[network]

        if (! networkConfigs) throw new Error('Network not configured')

        return networkConfigs
    }

    connect(providerUrl, network, chainId) {
        const provider = providerUrl.startsWith('wss:')
            ? new MyWebSocketProvider({url: providerUrl, ...this.connectionParams}, { network, chainId })
            : new StaticJsonRpcProvider({url: providerUrl, ...this.connectionParams}, { network, chainId })

        if (provider && provider._websocket && provider._websocket.on) {
            provider._websocket.on('error', function (e) {
            console.error(`[${new Date().toLocaleString()}] provider RPC "[${providerUrl}]" return socket error`, e)
            })
        }

        return provider
    }

    reconnectAllByNetwork(network) {
        this.byNetwork[network].map((info, index) => {
            this.byNetwork[network][index].provider = connect(info.url, network, info.chainId)
        })
    }

    chooseProvider(networkName, propertyOrMethod, sendMethodFirstArgument, failedProviders = []) {
        // console.log(`--- Called method and args: ${propertyOrMethod} ${arguments}`)
        // console.log(`--- ${networkName} RATINGS: ${this.byNetwork[networkName].map(p => `\n(url: ${p.url}, rating: ${p.rating})`)}`)

        // plan
        // search the tags for the passed propertyOrMethod.
        // if nothing is found, check if propertyOrMethod is 'send'.
        // if it is 'send', search the tags for arguments[0] (eth method name)
        // if nothing is found, rotate
        // if found in all providers, rotate
        // if found in 0 < x < max providers, set one of those providers
    
        const networkRPCs = this.byNetwork[networkName]
    
        let validRPCs = networkRPCs.filter(i => i['tags'].includes(propertyOrMethod))
        if (validRPCs.length == 0 && propertyOrMethod == 'send') {
            validRPCs = networkRPCs.filter(i => i['tags'].includes(sendMethodFirstArgument))
        }
    
        const uniqueFailedProviderUrls = [...new Set(failedProviders.map(provider => provider.connection.url))]
    
        // if there are no specific providers, set them back to all.
        // or... if we hit the fallback mechanism and all the specific
        // RPCs for this request failed, just choose one of all possible.
        if (
            validRPCs.length == 0
            || (
                uniqueFailedProviderUrls.length > 0
                && validRPCs.length == uniqueFailedProviderUrls.length
                && validRPCs.filter(rpc => uniqueFailedProviderUrls.includes(rpc.url)).length == uniqueFailedProviderUrls.length
            )
        ) {
            // try to exclude the failed RPCs... but if there are no other RPCs
            // available, we have no choice except to try again with the failed one
            if (uniqueFailedProviderUrls.length > 0) {
                validRPCs = networkRPCs.filter(rpc => ! uniqueFailedProviderUrls.includes(rpc.url))
            }
            if (validRPCs.length == 0) validRPCs = networkRPCs
        }
    
        // take the ones with the highest ratings only and rotate them
        validRPCs = getProvidersWithHighestRating(validRPCs)
        return this.roundRobbinRotate(networkName, validRPCs)
    }

    roundRobbinRotate(networkName, singleNetworkRPCs) {
        const currentIndex = this.getCurrentProviderIndex(networkName, singleNetworkRPCs);
        this.byNetworkCounter[networkName]++;
    
        const urls = singleNetworkRPCs.map(rpc => rpc.url)
        return this.byNetwork[networkName].filter(info => urls.includes(info.url))[currentIndex].provider
    }

    getCurrentProviderIndex(network, filteredProviders = []) {
        const finalProviders = filteredProviders.length
            ? filteredProviders
            : this.byNetwork[network]['RPCs']
    
        return this.byNetworkCounter[network] % finalProviders.length
    }

    lowerProviderRating(networkName, provider) {
        // lower the rating
        this.byNetwork[networkName].map((object, index) => {
            if (object.url == provider.connection.url) {
                this.byNetwork[networkName][index].rating = this.byNetwork[networkName][index].rating - 1
    
                redisClient.set(
                    getRatingKey(networkName, provider.connection.url),
                    this.byNetwork[networkName][index].rating,
                    'EX',
                    this.lowRatingExpiry
                );
            }
        })
    }

    resetProviderRating(networkName, providerUrl) {
        this.byNetwork[networkName].filter(info => info.url == providerUrl)[0].rating = defaultRating
    }
}

// return only the providers that have the highest rating
function getProvidersWithHighestRating(singleNetworkProviders) {
    const sorted = singleNetworkProviders.sort(function(a, b) {
        return b.rating - a.rating
    })

    // console.log(`--- ratings: ${sorted.map(p => `(url: ${p.url}, rating: ${p.rating})`)}`)
    const highest = sorted[0].rating
    return sorted.filter(one => {
        return one.rating == highest
    })
}

// get the key we are using in redis for the rating
function getRatingKey(network, url) {
    return network + REDIS_KEY_DELIMETER + url
}

module.exports = { ProviderStore }
