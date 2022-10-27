const { StaticJsonRpcProvider } = require('ethers').providers
const { MyWebSocketProvider } = require('./providers/websocket-provider')

const redis = require("redis")
const { promisify } = require('util');

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const redisClient = redis.createClient(redisUrl);

const redisGet = promisify(redisClient.get).bind(redisClient)
const redisSet = promisify(redisClient.set).bind(redisClient)
const redisEval = promisify(redisClient.eval).bind(redisClient)

const defaultRating = 100
const defaultConnectionParams = {timeout: 10000, throttleLimit: 2, throttleSlotInterval: 10}
const defaultLowRatingExpiry = 60 * 5 // seconds

class ProviderStore {
    byNetwork = {}
    byNetworkLastUsedProviderUrl = {}
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
            this.byNetworkLastUsedProviderUrl[network] = null
            this.byNetworkLatestBlock[network] = 0

            for (let providerInfo of _providersConfig[network]['RPCs']) {
                const providerUrl = providerInfo['url']
                const provider = this.connect(providerUrl, network, chainId)

                const providerConfig = {
                    url: providerUrl,
                    provider: provider,
                    tags: providerInfo['tags'],
                    chainId: chainId,
                    rating: defaultRating,
                    lastBlockTimestamp: (new Date()).getTime()
                }

                this.byNetwork[network].push(providerConfig)

                // load cached rating from Redis, if any
                redisGet(getRatingKey(network, providerUrl)).then((ratingValue) => {
                    if (!ratingValue) return

                    this.byNetwork[network].filter(config => config.url == providerUrl)[0].rating = ratingValue
                })

                provider.on('block', async (blockNum) => {
                    providerConfig.lastBlockTimestamp = (new Date()).getTime()

                    if (blockNum <= this.byNetworkLatestBlock[network]) return

                    this.byNetworkLatestBlock[network] = blockNum
                    provider.emit('latest-block', blockNum)
                })

                this.startProviderPinger(network, providerUrl)
            }
        }
    }

    // mechanism for poll/ping of provider when not responding
    startProviderPinger(network, providerUrl) {
        // redis cmd to increase counter and update its expire timeout
        const REDIS_CMD = "redis.call('incr',KEYS[1]); redis.call('EXPIRE',KEYS[1],ARGV[1]); return redis.call('GET', KEYS[1])"

        const REDIS_FAIL_KEY = `fail:${network}:${providerUrl}`
        const REDIS_SUCCESS_KEY = `success:${network}:${providerUrl}`
        const PING_INTERVAL = 10    // seconds
        const MAX_FAILS = 2
        const MIN_SUCCESSES = 3

        // max interval between blocks
        const MAX_INTER_BLOCK_INTERVAL = 30 // seconds

        let pingInProgress = false

        // const sleep1 = () => new Promise(resolve => setTimeout(resolve, 10000))

        setInterval(async () => {
            const providerConfig = this.byNetwork[network].filter(config => config.url == providerUrl)[0]
            console.log(`---- Provider rating: ${providerConfig.rating} (${providerConfig.url}) ------- last block time: ${providerConfig.lastBlockTimestamp}`)

            // all good, no need to ping yet
            if (
                providerConfig.rating >= defaultRating
                && (new Date()).getTime() - providerConfig.lastBlockTimestamp < MAX_INTER_BLOCK_INTERVAL * 1000
            ) {
                console.log(`---- All good, no need to ping yet: ${providerConfig.url}`)
                return
            }

            console.log(`---- Recent fail or no block for 30secs - initiating ping: ${providerConfig.url}`)

            const failKeyValue = await redisGet(REDIS_FAIL_KEY)
            const fails = parseInt(failKeyValue ?? 0)
            console.log(fails, pingInProgress)

            if (pingInProgress) {
                console.log(`---- PING IN PROGRESS, SKIPPING PING: ${providerUrl}`)
                return
            }

            if (fails >= MAX_FAILS) {
                console.log(`---- SOON REACHED MAX FAILS, WAITING: ${providerUrl}`)
                return
            }

            const pingStarted = (new Date()).getTime()
            pingInProgress = true
            console.log(`---- SET - PING IN PROGRESS`)

            try {
                // await sleep1()

                const block = await providerConfig.provider.getBlock()
                console.log(`---- fetched block: ${block.number}`)

                // recovery phase
                if (providerConfig.rating < defaultRating) {
                    console.log(`------- SUCCESS: ${providerConfig.url}`)

                    const successesUpdated = await redisEval(REDIS_CMD, 1, REDIS_SUCCESS_KEY, (MIN_SUCCESSES + 1) * PING_INTERVAL)
    
                    if (successesUpdated >= MIN_SUCCESSES) {
                        console.log(`------- RESTORING PROVIDER RATING: ${providerConfig.url}`)

                        this.resetProviderRating(network, providerConfig.provider)
                    }
                }
            } catch(error) {
                console.log(`------- FAILED: ${providerConfig.url} --- ${error}`)

                const failsUpdated = await redisEval(REDIS_CMD, 1, REDIS_FAIL_KEY, (fails + 1) * PING_INTERVAL * 3)

                if (failsUpdated >= MAX_FAILS ) {
                    console.log(`------- MAX FAILS, LOWERING PROVIDER RATING: ${providerConfig.url}`)

                    this.lowerProviderRating(network, providerConfig.provider)
                }
            } finally {
                pingInProgress = false
                console.log(`---- SET - PING FINISHED --- time taken: ${(new Date()).getTime() - pingStarted}`)
            }
        }, PING_INTERVAL * 1000)
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
            ? new MyWebSocketProvider(providerUrl, { network, chainId })
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
            this.byNetwork[network][index].provider = this.connect(info.url, network, info.chainId)
        })
    }

    chooseProvider(networkName, propertyOrMethod, sendMethodFirstArgument) {
        let networkRPCs = this.byNetwork[networkName]
    
        // take the ones with the highest ratings only
        // (this means that we take either only not failed ones
        // or if all have failed recently, then we'll get ones
        // which failed longest time ago)
        networkRPCs = getProvidersWithHighestRating(networkRPCs)

        // search the tags for the passed propertyOrMethod.
        // if nothing is found, check if propertyOrMethod is 'send'.
        // if it is 'send', search the tags for arguments[0] (eth method name)
        let validRPCs = networkRPCs.filter(i => i['tags'].includes(propertyOrMethod))
        if (validRPCs.length == 0 && propertyOrMethod == 'send') {
            validRPCs = networkRPCs.filter(i => i['tags'].includes(sendMethodFirstArgument))
        }
    
        // if there are no matching providers, set them back to all
        validRPCs = validRPCs.length == 0 ? networkRPCs : validRPCs

        return this.pickProvider(networkName, validRPCs)
    }

    pickProvider(networkName, availableProviderConfigs) {
        let providerConfig

        // try to pick a random provider other than the last used one
        // if there's none other, than just use the same again
        const otherProviderConfigs = availableProviderConfigs.filter(config => config.url != this.byNetworkLastUsedProviderUrl[networkName])
        if (otherProviderConfigs.length > 0) {
            const pickIndex = Math.floor(Math.random() * otherProviderConfigs.length)
            providerConfig = otherProviderConfigs[pickIndex]
        } else {
            providerConfig = availableProviderConfigs[0]
        }

        this.byNetworkLastUsedProviderUrl[networkName] = providerConfig.url

        return providerConfig.provider
    }

    lowerProviderRating(networkName, provider) {
        // lower the rating
        const providerConfig = this.byNetwork[networkName].filter(providerConfig => providerConfig.url == provider.connection.url)[0]
        if (!providerConfig) throw new Error(`Bad network or provider url: ${networkName}, ${provider.connection.url}`)

        providerConfig.rating = providerConfig.rating - 1
        redisSet(getRatingKey(networkName, providerConfig.url), providerConfig.rating)

        // this.byNetwork[networkName].map((providerConfig, index) => {
        //     if (providerConfig.url == provider.connection.url) {
        //         // this.byNetwork[networkName][index].rating = this.byNetwork[networkName][index].rating - 1
        //         providerConfig.rating = providerConfig.rating - 1
        //         redisSet(getRatingKey(networkName, provider.connection.url), this.byNetwork[networkName][index].rating)
        //     }
        //     return providerConfig
        // })
    }

    resetProviderRating(networkName, provider) {
        // this.byNetwork[networkName].filter(info => info.url == providerUrl)[0].rating = defaultRating

        const providerConfig = this.byNetwork[networkName].filter(providerConfig => providerConfig.url == provider.connection.url)[0]
        if (!providerConfig) throw new Error(`Bad network or provider url: ${networkName}, ${provider.connection.url}`)

        providerConfig.rating = defaultRating
        redisSet(getRatingKey(networkName, providerConfig.url), providerConfig.rating)
    }
}

// return only the provider configs that have the highest rating
function getProvidersWithHighestRating(singleNetworkProviderConfigs) {
    const sorted = singleNetworkProviderConfigs.sort((a, b) => b.rating - a.rating)

    const highest = sorted[0].rating
    return sorted.filter(providerConfig => providerConfig.rating == highest)
}

// get the key we are using in redis for the rating
function getRatingKey(network, url) {
    return `rating:${network}:${url}`
}

module.exports = { ProviderStore }
