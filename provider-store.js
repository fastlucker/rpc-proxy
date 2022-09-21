const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

const MAX_FAILS_PER_CALL = 1

const byNetwork = {}
const byNetworkCounter = {}
const byNetworkLatestBlock = {}

function connect(providerUrl, network, chainId, connectionParams) {
    const provider = providerUrl.startsWith('wss:')
        ? new WebSocketProvider({url: providerUrl, ...connectionParams}, { network, chainId })
        : new StaticJsonRpcProvider({url: providerUrl, ...connectionParams}, { network, chainId })

    if (provider && provider._websocket && provider._websocket.on) {
        provider._websocket.on('error', function (e) {
        console.error(`[${new Date().toLocaleString()}] provider RPC "[${providerUrl}]" return socket error`, e)
        })
    }

    return provider
}

function reconnectAllByNetwork(networkName, connectionParams) {
    byNetwork[networkName].map((info, index) => {
        byNetwork[networkName][index].provider = connect(info.url, networkName, info.chainId, connectionParams)
    })
}

function chooseProvider(networkName, propertyOrMethod, sendMethodFirstArgument, failedProviders = []) {
    // console.log(`--- Called method and args: ${propertyOrMethod} ${arguments}`)

    // plan
    // search the tags for the passed propertyOrMethod.
    // if nothing is found, check if propertyOrMethod is send.
    // if it is send, search the tags for arguments[0] (eth method name)
    // if nothing is found, rotate
    // if found in all providers, rotate
    // if found in 0 < x < max providers, set one of those providers

    const networkRPCs = byNetwork[networkName]

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
    return roundRobbinRotate(networkName, validRPCs)
}

function roundRobbinRotate(networkName, singleNetworkRPCs) {
    const currentIndex = getCurrentProviderIndex(networkName, singleNetworkRPCs);
    byNetworkCounter[networkName]++;

    const urls = singleNetworkRPCs.map(rpc => rpc.url)
    return byNetwork[networkName].filter(info => urls.includes(info.url))[currentIndex].provider
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

function getCurrentProviderIndex (network, filteredProviders = []) {
    const finalProviders = filteredProviders.length
    ? filteredProviders
    : byNetwork[network]['RPCs']

    return byNetworkCounter[network] % finalProviders.length
}

function lowerProviderRating(networkName, provider) {
    // lower the rating
    byNetwork[networkName].map((object, index) => {
        if (object.url == provider.connection.url) {
            byNetwork[networkName][index].rating = byNetwork[networkName][index].rating - 1

            // redisClient.set(
            //     getRatingKey(networkName, provider.connection.url),
            //     byNetwork[networkName][index].rating,
            //     'EX',
            //     60 * 5
            // );
        }
    })
}

// get the key we are using in redis for the rating
function getRatingKey(network, url) {
    return network + '_split_key_here_' + url
}

function handleProviderFail(e, networkName, provider, failedProviders) {
    lowerProviderRating(networkName, provider)
    failedProviders.push(provider)

    if (failedProviders.length > MAX_FAILS_PER_CALL) {
        throw e;
    }

    return failedProviders
}

module.exports = {
    byNetwork,
    byNetworkCounter,
    byNetworkLatestBlock,
    connect,
    reconnectAllByNetwork,
    chooseProvider,
    handleProviderFail
}
