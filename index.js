const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

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
    byNetwork[network].push(getProxy(network, providerUrl, chainId))
  }
}

function getProxy(networkName, providerUrl, chainId) {
  const rpc = new CustomRPC(networkName, providerUrl, chainId)
  const provider = rpc.getProvider()

  return new Proxy(provider, {
    get: function get(target, prop, receiver) {

      // an example of how to access the send function and its
      // arguments like eth_blockNumber, eth_getBlockByNumber.
      if (prop == 'send' && typeof(provider[prop]) == 'function') {

        return function() {
          // an example response from console.log:
          // [Arguments] { '0': 'eth_blockNumber', '1': [] }
          // here, we can go further down and do:
          // if (arguments[0] == 'eth_blockNumber') do smt
          console.log(arguments)
          return target[prop].apply( this, arguments );
        }
      }

      return Reflect.get(...arguments)
    }
  });
}

class CustomRPC {
  provider = null

  constructor(networkName, url, chainId) {

    this.provider = url.startsWith('wss:')
      ? new WebSocketProvider(url, { networkName, chainId })
      : new StaticJsonRpcProvider(url, { networkName, chainId })

    if (this.provider) {
      this.provider.on('error', function (e) {
        console.error(`[${new Date().toLocaleString()}] RPC "[${url}]" return error`, e)
      })
    }

    if (this.provider && this.provider._websocket && this.provider._websocket.on) {
      this.provider._websocket.on('error', function (e) {
        console.error(`[${new Date().toLocaleString()}] provider RPC "[${url}]" return socket error`, e)
      })
    }
  }

  getProvider() {
    return this.provider
  }
}

function getCurrentProviderIndex (network) {
  return byNetworkCounter[network] % providers[network].length
}

function getProvider(networkName) {
  if (! byNetwork[networkName]) return null

  const currentIndex = getCurrentProviderIndex(networkName);
  byNetworkCounter[networkName]++;

  console.log('Current index is: ' + currentIndex)

  return byNetwork[networkName][currentIndex]
    ? byNetwork[networkName][currentIndex]
    : null
}

init()

module.exports = { getProvider }
