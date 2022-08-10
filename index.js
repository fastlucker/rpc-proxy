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
        provider.on('error', function (e) {
          console.error(`[${new Date().toLocaleString()}] RPC "[${providerUrl}]" return error`, e)
        })

        // if there is an error in debug, lower the rating of the RPC that has an error
        // provider.on('debug', function (e) {
        //   if (e.error) {
        //     const errorNetwork = e.provider._network.network
        //     const errorProviderUrl = e.provider.connection.url

        //     byNetwork[errorNetwork].filter(i => i.url == errorProviderUrl)[0].rating--
        //   }
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

function getProvider(networkName, chainId) {
  if (! byNetwork[networkName]) return null

  return new Proxy({}, {
    get: function get(target, prop, receiver) {
      let result

      // target only the send function as the send function
      // is the one calling eth_call, eth_sendTransaction
      if (typeof(byNetwork[networkName][0].provider[prop]) == 'function') {
        return async function() {
          const provider = chooseProvider(networkName, prop, arguments)

          // simulate/return chain id without making an RPC call
          if (prop === 'send' && arguments[0] === 'eth_chainId') {
            result = `0x${provider._network.chainId.toString(16)}`
            logCall(provider, prop, arguments, true, result)
            return result
          }

          try {
            result = await provider[prop]( ...arguments )
            logCall(provider, prop, arguments, false, result)
            return new Promise(resolve => resolve(result))
          } catch (e) {
            console.log('an error was returned, lowering the rating')
            console.log(e)
            byNetwork[networkName].filter(i => i.url == provider.connection.url)[0].rating--
            const newProvider = chooseProvider(networkName, prop, arguments)
            result = newProvider[prop]( ...arguments )
            logCall(newProvider, prop, arguments, false, result)
            return result
          }
        }
      }

      const provider = chooseProvider(networkName, prop, arguments)
      result = provider[prop]
      logCall(provider, prop, arguments, false, result)
      return result
    }
  })
}

function chooseProvider(networkName, propertyOrMethod, arguments) {
  // console.log(`--- Called method and args: ${propertyOrMethod} ${arguments}`)

  // plan
  // search the tags for the passed propertyOrMethod.
  // if nothing is found, check if propertyOrMethod is send.
  // if it is send, search the tags for arguments[0] (eth method name)
  // if nothing is found, rotate
  // if found in all providers, rotate
  // if found in 0 < x < max providers, set one of those providers

  const networkRPCs = providers[networkName]['RPCs']

  let validProviders = networkRPCs.filter(i => i['tags'].includes(propertyOrMethod))
  if (validProviders.length == 0 && propertyOrMethod == 'send') {
    validProviders = networkRPCs.filter(i => i['tags'].includes(arguments[0]))
  }

  // if there are no specific providers, set them back to all
  if (validProviders.length == 0) {
    validProviders = byNetwork[networkName]
  }

  // take the ones with the highest ratings only and rotate them
  validProviders = getProvidersWithHighestRating(validProviders)
  return roundRobbinRotate(networkName, validProviders)
}

function roundRobbinRotate(networkName, singleNetworkProviders) {
  const currentIndex = getCurrentProviderIndex(networkName, singleNetworkProviders);
  byNetworkCounter[networkName]++;

  // console.log('Round robbin, network: '+ networkName +'. Current index is: ' + currentIndex)
  return byNetwork[networkName][currentIndex].provider
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

function getCurrentProviderIndex (network, filteredProviders = null) {
  const finalProviders = filteredProviders != null
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

init()

module.exports = { getProvider, callLog, getByNetwork, setByNetwork }
