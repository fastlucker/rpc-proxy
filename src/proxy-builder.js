const { Logger } = require('@ethersproject/logger')
const rpcCallLogger = require('./utils/rpc-call-logger')

const defaultMaxFailsPerCall = 2

class ProxyBuilder {
    providerStore = null
    maxFailsPerCall = null

    constructor(_providerStore, _maxFailsPerCall = null) {
        this.providerStore = _providerStore
        this.maxFailsPerCall = _maxFailsPerCall === null ? defaultMaxFailsPerCall : parseInt(_maxFailsPerCall)
    }

    buildProxy(networkName) {
        return new Proxy({}, {
            get: (target, prop, receiver) => {

                if (prop == 'restart') {
                    console.log(`[${new Date().toLocaleString()}] restarted`)
    
                    // restart all the providers in the network
                    this.providerStore.reconnectAllByNetwork(networkName)
                    return
                }

                // target only the send function as the send function
                // is the one calling eth_call, eth_sendTransaction
                if (typeof(this.providerStore.getByNetwork(networkName)[0].provider[prop]) == 'function') {
                    const self = this
                    return async function() {
                        return self.handleTypeFunction(networkName, prop, arguments)
                    }
                }

                return this.handleTypePropGet(networkName, prop, arguments)
            },
            set: (target, prop, value) => {
                return this.handleTypePropSet(networkName, prop, value)
            }
        })
    }

    // The function handler try block
    async handleTypeFunction(networkName, prop, args, providerFails = 0) {
        // special treatment for these methods calls, related to event subscribe/unsubscribe
        if (['on', 'once', 'off'].includes(prop)) {
            const _providers = this.providerStore.getByNetwork(networkName).map(i => i.provider)
            for (const _provider of _providers) {
                _provider[prop]( ...args )
                rpcCallLogger.logCall(_provider, prop, args)
            }
            return
        }

        const provider = this.providerStore.chooseProvider(networkName, prop, args[0])
        console.log(`--- ${networkName} - ${provider.connection.url} --- method: ${prop} args: ${JSON.stringify(args)} --- retries: ${providerFails}`)

        let result

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
                result = await result
                rpcCallLogger.logCall(provider, prop, args, false, result)
                return new Promise(resolve => resolve(result))
            }
            rpcCallLogger.logCall(provider, prop, args, false, result)
            return result

        } catch (e) {
            providerFails = this.handleProviderFail(e, networkName, provider, providerFails)
            return this.handleTypeFunction(networkName, prop, args, providerFails)
        }
    }

    // The property handler try block.
    // The difference is that the tryBlock is an async function while this one is not
    handleTypePropGet(networkName, prop, args, providerFails = 0) {
        const provider = this.providerStore.chooseProvider(networkName, prop, args[0])
        console.log(`--- ${networkName} - ${provider.connection.url} --- property: ${prop} --- retries: ${providerFails}`)

        let result

        try {
            result = provider[prop]
            rpcCallLogger.logCall(provider, prop, args, false, result)
            return result
        } catch (e) {
            providerFails = this.handleProviderFail(e, networkName, provider, providerFails)
            return this.handleTypePropGet(networkName, prop, args, providerFails)
        }
    }

    handleTypePropSet(networkName, prop, value) {
        // when setting a property, we would want to set it to all providers for this network
        const _providers = this.providerStore.getByNetwork(networkName).map(i => i.provider)
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

    handleProviderFail(e, networkName, provider, providerFails) {
        this.providerStore.lowerProviderRating(networkName, provider)
        providerFails++

        if (providerFails > this.maxFailsPerCall) {
            throw e;
        }

        return providerFails
    }
}

module.exports = { ProxyBuilder }
