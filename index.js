const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

const providers = require('./providers')

const byNetwork = {}
const byNetworkCounter = {}
let callCount = 0
const callLog = []

function logCall(provider, propertyOrMethod, arguments, cached, res) {
  callLog.push({
    id: callCount,
    providerUrl: provider ? provider.connection.url : null,
    propertyOrMethod: propertyOrMethod,
    args: arguments,
    cached: cached,
    response: res
  })
  callCount++
}

function init () {
  for (const network in providers) {
    const chainId = providers[network]['chainId']
    byNetwork[network] = []
    byNetworkCounter[network] = 1

    for (let providerInfo of providers[network]['RPCs']) {
      const connectionParams = {timeout: 3000, throttleLimit: 2, throttleSlotInterval: 10}
      const providerUrl = providerInfo['url']
      const provider = providerUrl.startsWith('wss:')
        ? new WebSocketProvider({url: providerUrl, ...connectionParams}, { network, chainId })
        : new StaticJsonRpcProvider({url: providerUrl, ...connectionParams}, { network, chainId })

      if (provider) {
        // provider.on('error', function (e) {
        //   console.error(`[${new Date().toLocaleString()}] RPC "[${providerUrl}]" return error`, e)
        // })
      }

      if (provider && provider._websocket && provider._websocket.on) {
        provider._websocket.on('error', function (e) {
          console.error(`[${new Date().toLocaleString()}] provider RPC "[${providerUrl}]" return socket error`, e)
        })
      }

      byNetwork[network].push({
        url: providerUrl,
        provider: provider,
        rating: 100
      })
    }
  }
}

function getProvider(networkName) {
  if (! byNetwork[networkName]) return null

  return new Proxy({}, {
    get: function get(target, prop, receiver) {
      let result

      // target only the send function as the send function
      // is the one calling eth_call, eth_sendTransaction
      if (typeof(byNetwork[networkName][0].provider[prop]) == 'function') {
        return async function() {
          const provider = chooseProvider(networkName, prop, arguments[0])
          return handleTypeFunction(networkName, provider, prop, arguments)
        }
      }

      const provider = chooseProvider(networkName, prop, arguments[0])
      return handleTypeProp(networkName, provider, prop, arguments)
    }
  })
}

function chooseProvider(networkName, propertyOrMethod, sendMethodFirstArgument, failedProvider = null) {
  // console.log(`--- Called method and args: ${propertyOrMethod} ${arguments}`)

  // plan
  // search the tags for the passed propertyOrMethod.
  // if nothing is found, check if propertyOrMethod is send.
  // if it is send, search the tags for arguments[0] (eth method name)
  // if nothing is found, rotate
  // if found in all providers, rotate
  // if found in 0 < x < max providers, set one of those providers

  const networkRPCs = providers[networkName]['RPCs']

  let validRPCs = networkRPCs.filter(i => i['tags'].includes(propertyOrMethod))
  if (validRPCs.length == 0 && propertyOrMethod == 'send') {
    validRPCs = networkRPCs.filter(i => i['tags'].includes(sendMethodFirstArgument))
  }

  // if there are no specific providers, set them back to all.
  // or... if we hit the fallback mechanism and all the specific
  // RPCs for this request failed, just choose one of all possible.
  if (
    validRPCs.length == 0
    || (
      failedProvider != null
      && validRPCs.length == 1
      && validRPCs[0].url == failedProvider.connection.url
    )
  ) {
    // try to exclude the failed RPC... but if there are no other RPCs
    // available, we have no choice except to try again with the failed one
    if (failedProvider) {
      validRPCs = networkRPCs.filter(rpc => rpc.url != failedProvider.connection.url)
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
  const highest = sorted[0].rating
  return sorted.filter(one => {
    return one.rating == highest
  })
}

function getCurrentProviderIndex (network, filteredProviders = []) {
  const finalProviders = filteredProviders.length
    ? filteredProviders
    : providers[network]['RPCs']

  return byNetworkCounter[network] % finalProviders.length
}

function getByNetwork() {
  return byNetwork
}

function setByNetwork(mockedProviders) {
  return mockedProviders
}

// The function handler try block
async function handleTypeFunction(networkName, provider, prop, arguments, counter = 0) {
  try {
    // simulate/return chain id without making an RPC call
    if (prop === 'send' && arguments[0] === 'eth_chainId') {
      result = `0x${provider._network.chainId.toString(16)}`
      logCall(provider, prop, arguments, true, result)
      return result
    }

    // #buggy: fixup argument if 'getBlock' or 'getBlockWithTransactions' are called
    // related to this discussion: https://github.com/ethers-io/ethers.js/discussions/3072
    if (['getBlock', 'getBlockWithTransactions'].includes(prop)) {
      arguments[0] = arguments[0] == -1 ? 'latest' : arguments[0]
    }

    result = provider[prop]( ...arguments )

    if (typeof result === 'object' && typeof result.then === 'function') {

      if (networkName == 'polygon' && prop == 'send' && arguments[0] === 'eth_sendRawTransaction') {
        console.log('FOR eth_sendRawTransaction: ' + provider.connection.url)
      }

      result = await result
      logCall(provider, prop, arguments, false, result)
      return new Promise(resolve => resolve(result))
    }
    logCall(provider, prop, arguments, false, result)
    return result

  } catch (e) {
    const newProvider = getNewProviderOrStopExec(counter, networkName, prop, provider)
    return handleTypeFunction(networkName, newProvider, prop, arguments, counter++)
  }
}

// The property handler try block.
// The difference is that the tryBlock is an async function while this one is not
function handleTypeProp(networkName, provider, prop, arguments, counter = 0) {
  try {
    result = provider[prop]
    logCall(provider, prop, arguments, false, result)
    return result
  } catch (e) {
    const newProvider = getNewProviderOrStopExec(counter, networkName, prop, provider)
    return handleTypeProp(networkName, newProvider, prop, arguments, counter++)
  }
}

function getNewProviderOrStopExec(counter, networkName, prop, provider) {
  // MAX: the number of fallbacks we want to have
  if (counter >= 1) {
    throw e;
  }

  // lower the rating
  byNetwork[networkName].map((object, index) => {
    if (object.url == provider.connection.url) {
      byNetwork[networkName][index].rating = byNetwork[networkName][index].rating - 1
    }
  })

  return chooseProvider(networkName, prop, arguments[0], provider)
}

init()

module.exports = { getProvider, callLog, getByNetwork, setByNetwork }
