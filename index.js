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
      const providerUrl = providerInfo['url']
      const provider = providerUrl.startsWith('wss:')
        ? new WebSocketProvider(providerUrl, { network, chainId })
        : new StaticJsonRpcProvider(providerUrl, { network, chainId })

      if (provider) {
        provider.on('error', function (e) {
          console.error(`[${new Date().toLocaleString()}] RPC "[${providerUrl}]" return error`, e)
        })
      }

      if (provider && provider._websocket && provider._websocket.on) {
        provider._websocket.on('error', function (e) {
          console.error(`[${new Date().toLocaleString()}] provider RPC "[${providerUrl}]" return socket error`, e)
        })
      }

      byNetwork[network].push({
        url: providerUrl,
        provider: provider
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
        return function() {
          const provider = chooseProvider(networkName, prop, arguments)

          // simulate/return chain id without making an RPC call
          if (prop === 'send' && arguments[0] === 'eth_chainId') {
            result = `0x${provider._network.chainId.toString(16)}`
            logCall(provider, prop, arguments, true, result)
            return result
          }

          result = provider[prop]( ...arguments )
          logCall(provider, prop, arguments, false, result)
          return result
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
  if (
    validProviders.length == 0 || validProviders.length == networkRPCs.length
  ) {
    return roundRobbinRotate(networkName)
  }

  if (propertyOrMethod == 'send') {
    // console.log('Send eth method: ' + arguments[0])
  }

  const rnd = Math.floor(Math.random() * validProviders.length)
  // console.log('Setting predefined with index: ' + rnd)
  const providerUrl = validProviders[rnd]['url']
  return byNetwork[networkName].filter(i => i.url == providerUrl)[0].provider
}

function roundRobbinRotate(networkName) {

  const currentIndex = getCurrentProviderIndex(networkName);
  byNetworkCounter[networkName]++;

  // console.log('Round robbin rotate. Current index is: ' + currentIndex)
  return byNetwork[networkName][currentIndex].provider
}

function getCurrentProviderIndex (network) {
  return byNetworkCounter[network] % providers[network]['RPCs'].length
}

function getByNetwork() {
  return byNetwork
}

function setByNetwork(mockedProviders) {
  return mockedProviders
}

init()

module.exports = { getProvider, callLog, getByNetwork, setByNetwork }
