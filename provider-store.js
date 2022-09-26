const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

const defaultRating = 100
const defaultConnectionParams = {timeout: 5000, throttleLimit: 2, throttleSlotInterval: 10}

class ProviderStore {
    byNetwork = {}
    byNetworkCounter = {}
    byNetworkLatestBlock = {}
    connectionParams = {}
    redisClient = null

    constructor(_redisClient, _providersConfig, _connectionParams = {}) {
        this.redisClient = _redisClient

        // override default connection params if provided as input
        this.connectionParams = Object.assign(defaultConnectionParams, _connectionParams);

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
                this.redisClient.get(getRatingKey(network, providerUrl), (err, value) => {
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
    }

    isInitialized() {
        return ! (Object.keys(this.byNetwork).length === 0)
    }

    connect(providerUrl, network, chainId) {
        const provider = providerUrl.startsWith('wss:')
            ? new WebSocketProvider({url: providerUrl, ...this.connectionParams}, { network, chainId })
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
    
                this.redisClient.set(
                    getRatingKey(networkName, provider.connection.url),
                    this.byNetwork[networkName][index].rating,
                    'EX',
                    60 * 5
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
    return network + '_split_key_here_' + url
}

module.exports = { ProviderStore }
