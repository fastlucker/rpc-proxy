const { Logger } = require('@ethersproject/logger')
const providerStore = require('./provider-store')
const rpcCallLogger = require('./loggers/rpc-calls')

function buildProxy(networkName) {
    return new Proxy({}, {
        get: function(target, prop, receiver) {

            if (prop == 'restart') {
                console.log(`[${new Date().toLocaleString()}] restarted`)

                // restart all the providers in the network
                providerStore.reconnectAllByNetwork(networkName, finalConnectionParams)
                return
            }

            // target only the send function as the send function
            // is the one calling eth_call, eth_sendTransaction
            if (typeof(providerStore.byNetwork[networkName][0].provider[prop]) == 'function') {
                return async function() {
                    return handleTypeFunction(networkName, prop, arguments)
                }
            }

            return handleTypePropGet(networkName, prop, arguments)
        },
        set: function(target, prop, value) {
            return handleTypePropSet(networkName, prop, value)
        }
    })
}

// The function handler try block
async function handleTypeFunction(networkName, prop, args, failedProviders = []) {
    // special treatment for these methods calls, related to event subscribe/unsubscribe
    if (['on', 'once', 'off'].includes(prop)) {
        const _providers = providerStore.byNetwork[networkName].map(p => p.provider)
        for (const _provider of _providers) {
            _provider[prop]( ...args )
            rpcCallLogger.logCall(_provider, prop, args)
        }
        return
    }

    const provider = providerStore.chooseProvider(networkName, prop, args[0], failedProviders)
    console.log(`--- ${networkName} - ${provider.connection.url} --- method and args: ${prop} ${args} --- retries: ${failedProviders.length}`)

    try {
        // simulate/return chain id without making an RPC call
        if (prop === 'send' && args[0] === 'eth_chainId') {
        result = `0x${provider._network.chainId.toString(16)}`
        rpcCallLogger.logCall(provider, prop, args, true, result)
        return result
        }

        // #buggy: fixup argument if 'getBlock' or 'getBlockWithTransactions' are called
        // related to this discussion: https://github.com/ethers-io/ethers.js/discussions/3072
        if (['getBlock', 'getBlockWithTransactions'].includes(prop)) {
            args[0] = args[0] == -1 ? 'latest' : args[0]
        }

        result = provider[prop]( ...args )

        if (typeof result === 'object' && typeof result.then === 'function') {
            if (networkName == 'polygon' && prop == 'send' && args[0] === 'eth_sendRawTransaction') {
                console.log('FOR eth_sendRawTransaction: ' + provider.connection.url)
            }

            result = await result
            rpcCallLogger.logCall(provider, prop, args, false, result)
            return new Promise(resolve => resolve(result))
        }
        rpcCallLogger.logCall(provider, prop, args, false, result)
        return result

    } catch (e) {
        failedProviders = providerStore.handleProviderFail(e, networkName, provider, failedProviders)
        return handleTypeFunction(networkName, prop, args, failedProviders)
    }
}

  // The property handler try block.
  // The difference is that the tryBlock is an async function while this one is not
function handleTypePropGet(networkName, prop, args, failedProviders = []) {
    const provider = providerStore.chooseProvider(networkName, prop, args[0], failedProviders)
    console.log(`--- ${networkName} - ${provider.connection.url} --- property: ${prop} --- retries: ${failedProviders.length}`)

    try {
        result = provider[prop]
        rpcCallLogger.logCall(provider, prop, args, false, result)
        return result
    } catch (e) {
        failedProviders = providerStore.handleProviderFail(e, networkName, provider, failedProviders)
        return handleTypePropGet(networkName, prop, args, failedProviders)
    }
}

function handleTypePropSet(networkName, prop, value) {
    // when setting a property, we would want to set it to all providers for this network
    const _providers = providerStore.byNetwork[networkName].map(p => p.provider)
    for (const _provider of _providers) {
        try {
            _provider[prop] = value
            rpcCallLogger.logCall(_provider, prop, value)
        } catch (e) {
            // not all provider types support all properties, so this is an expected error
            if (e.code === Logger.errors.UNSUPPORTED_OPERATION) continue
            throw e
        }
    }
}

module.exports = { buildProxy }
