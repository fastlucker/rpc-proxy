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
    providerPickAlgorithm = null

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
     * @param {string} _providerPickAlgorithm - Algorithm for picking provider for next request (possible: primary | round-robin)
     * 
     */
    constructor(_providersConfig, _connectionParams = {}, _lowRatingExpiry = null, _providerPickAlgorithm = 'primary') {
        // override default params if provided as input
        this.connectionParams = Object.assign(defaultConnectionParams, _connectionParams);
        this.lowRatingExpiry = _lowRatingExpiry === null ? defaultLowRatingExpiry : parseInt(_lowRatingExpiry)
        this.providerPickAlgorithm = _providerPickAlgorithm

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
                    primary: providerInfo['primary'] ?? false,
                    tags: providerInfo['tags'] ?? [],
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

                this.setupProvider(network, provider)

                this.startProviderPinger(network, provider)
            }
        }
    }

    setupProvider(network, provider) {
        const providerConfig = this.getProviderConfig(network, provider)

        provider.on('block', async (blockNum) => {
            providerConfig.lastBlockTimestamp = (new Date()).getTime()

            if (blockNum <= this.byNetworkLatestBlock[network]) return

            this.byNetworkLatestBlock[network] = blockNum
            provider.emit('latest-block', blockNum)
        })
    }

    // mechanism for poll/ping of provider when not responding
    startProviderPinger(network, provider) {
        const providerUrl = provider.connection.url

        // redis cmd to increase counter and update its expire timeout
        const REDIS_CMD = "redis.call('incr',KEYS[1]); redis.call('EXPIRE',KEYS[1],ARGV[1]); return redis.call('GET', KEYS[1])"

        const REDIS_FAIL_KEY = `fail:${network}:${providerUrl}`
        const REDIS_SUCCESS_KEY = `success:${network}:${providerUrl}`
        const PING_INTERVAL = 10    // seconds
        const PING_TIMEOUT = 10     // seconds
        const MAX_FAILS = 3
        const MIN_SUCCESSES = 5

        // max interval between blocks
        const MAX_INTER_BLOCK_INTERVAL = 30 // seconds

        let pingInProgress = false

        setInterval(async () => {
            const providerConfig = this.getProviderConfig(network, provider)
            console.log(`--- Provider rating: ${providerConfig.rating} (${providerConfig.url}) --- last block time: ${providerConfig.lastBlockTimestamp}`)

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
            console.log(`---- INITIATING PING: ${providerUrl}`)

            try {
                // race promises: complete providedr poll promise within PING_TIMEOUT seconds or reject/throw
                await Promise.race([
                    providerConfig.provider.getBlockNumber(),
                    new Promise((resolve, reject) => {
                        setTimeout(() => {
                            reject('Ping timeout')
                        }, PING_TIMEOUT * 1000)
                    })
                ])

                // recovery phase
                if (providerConfig.rating < defaultRating) {
                    console.log(`------- PING SUCCESS: ${providerConfig.url}`)

                    const successesUpdated = await redisEval(REDIS_CMD, 1, REDIS_SUCCESS_KEY, MIN_SUCCESSES * PING_INTERVAL)
                    if (successesUpdated >= MIN_SUCCESSES) {
                        console.log(`------- RESTORING PROVIDER RATING: ${providerConfig.url}`)

                        this.resetProviderRating(network, providerConfig.provider)
                    }
                }
            } catch(error) {
                console.log(`------- PING FAILED: ${providerConfig.url} --- ${error}`)

                const failsUpdated = await redisEval(REDIS_CMD, 1, REDIS_FAIL_KEY, (fails + 1) * PING_INTERVAL * 3)
                if (failsUpdated >= MAX_FAILS ) {
                    console.log(`------- MAX FAILS, LOWERING PROVIDER RATING: ${providerConfig.url}`)

                    this.lowerProviderRating(network, providerConfig.provider)
                }
            } finally {
                console.log(`---- PING FINISHED --- time taken: ${(new Date()).getTime() - pingStarted}`)
                pingInProgress = false
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

            provider._websocket.on('close', () => {
                setTimeout(() => {
                    this.reconnect(network, provider)
                }, 1000)
            })
        }

        return provider
    }

    reconnect(network, provider) {
        const providerConfig = this.getProviderConfig(network, provider)

        providerConfig.provider = this.connect(providerConfig.url, network, providerConfig.chainId)
        this.setupProvider(network, providerConfig.provider)
        console.log(`---------- RECONNECTED TO ${providerConfig.url}`)
    }

    reconnectAllByNetwork(network) {
        this.byNetwork[network].map(providerConfig => {
            this.reconnect(network, providerConfig.provider)
        })
    }

    chooseProvider(networkName, propertyOrMethod, sendMethodFirstArgument, algorithm = null) {
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

        return this.pickProvider(validRPCs, networkName, algorithm)
    }

    pickProvider(availableProviderConfigs, networkName, algorithm = null) {
        algorithm = algorithm ?? this.providerPickAlgorithm

        const algorithmMappings = {
            'primary': this.getProviderConfigPrimary.bind(this),
            'round-robin': this.getProviderConfigRoundRobin.bind(this)
        }

        const algorithmFunc = algorithmMappings[algorithm] ?? this.getProviderConfigPrimary.bind(this)

        const providerConfig = algorithmFunc(availableProviderConfigs, networkName)
        this.byNetworkLastUsedProviderUrl[networkName] = providerConfig.url

        return providerConfig.provider
    }

    // algorithm: primary
    getProviderConfigPrimary(availableProviderConfigs) {
        const primaryConfigs = availableProviderConfigs.filter(config => config.primary === true)

        if (primaryConfigs.length > 0) {
            return primaryConfigs[0]
        }

        return availableProviderConfigs[0]
    }

    // algorithm: round-robin
    getProviderConfigRoundRobin(availableProviderConfigs, networkName) {
        // try to pick a random provider other than the last used one
        // if there's none other, than just use the same again
        const otherProviderConfigs = availableProviderConfigs.filter(config => config.url != this.byNetworkLastUsedProviderUrl[networkName])
        if (otherProviderConfigs.length > 0) {
            const pickIndex = Math.floor(Math.random() * otherProviderConfigs.length)
            return otherProviderConfigs[pickIndex]
        }

        return availableProviderConfigs[0]
    }

    lowerProviderRating(networkName, provider) {
        const providerConfig = this.getProviderConfig(networkName, provider)

        providerConfig.rating = providerConfig.rating - 1
        redisSet(getRatingKey(networkName, providerConfig.url), providerConfig.rating)
    }

    resetProviderRating(networkName, provider) {
        const providerConfig = this.getProviderConfig(networkName, provider)

        providerConfig.rating = defaultRating
        redisSet(getRatingKey(networkName, providerConfig.url), providerConfig.rating)
    }

    getProviderConfig(networkName, provider) {
        const providerConfig = this.byNetwork[networkName].filter(providerConfig => providerConfig.url == provider.connection.url)[0]
        if (!providerConfig) throw new Error(`Bad network or provider url: ${networkName}, ${provider.connection.url}`)
        return providerConfig
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
