const { StaticJsonRpcProvider, WebSocketProvider, JsonRpcProvider } = require('ethers').providers

const providers = {
  polygon: [
    'https://polygon-rpc.com/rpc',
    'https://rpc.ankr.com/polygon',
  ]
}
const byNetwork = {}
const byNetworkCounter = {}

function init () {
  const network = 'polygon'
  const chainId = 137
  byNetwork[network] = []
  byNetworkCounter[network] = 1;

  for (let providerUrl of providers[network]) {

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

    byNetwork[network].push(provider)
  }
}

function getProvider(networkName, chainId) {
  if (! byNetwork[networkName]) return null
  const rpc = new CustomRPC()

  return new Proxy(rpc, {
    get: function get(target, prop, receiver) {

      const provider = chooseProvider(networkName, ...arguments)

      if (typeof(provider[prop]) == 'function') {
        return function() {
          return provider[prop]( ...arguments )
        }
      }

      return provider[prop]
    }
  });
}

function chooseProvider(networkName, prop, arguments) {
  const currentIndex = getCurrentProviderIndex(networkName);
  byNetworkCounter[networkName]++;

  console.log('Current index is: ' + currentIndex)

  return byNetwork[networkName][currentIndex]
}

class CustomRPC {
}

function getCurrentProviderIndex (network) {
  return byNetworkCounter[network] % providers[network].length
}

init()

module.exports = { getProvider }
