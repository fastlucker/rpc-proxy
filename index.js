const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

const providers = {
  polygon: [
    'https://polygon-rpc.com/rpc',
    'https://rpc.ankr.com/polygon',
  ]
}
let counter = 0;
const byNetwork = {}

class CustomRPC {
  provider = null

  constructor(networkName, chainId) {
    if (networkName !== 'polygon') return

    // move the counter
    counter++
    const currentIndex = this.getCurrentProviderIndex(networkName);
    if (byNetwork[networkName] && byNetwork[networkName][currentIndex]) {
      this.provider = byNetwork[networkName][currentIndex]
      return
    }

    const url = this.getProviderUrl(networkName)
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

    if (! byNetwork[networkName]) byNetwork[networkName] = {}
    byNetwork[networkName][currentIndex] = this.provider;
  }

  getCurrentProviderIndex (network) {
    return counter % providers[network].length
  }

  getProviderUrl (network) {
    const nextProviderIndex = this.getCurrentProviderIndex(network)

    console.log(`provider counter: ${counter}`)
    console.log(`provider index: ${nextProviderIndex}`)
    console.log(`provider url: ${providers[network][nextProviderIndex]}`)

    return providers[network][nextProviderIndex]
  }

  getProvider() {
    return this.provider
  }
}

function getProvider(networkName, chainId) {
  const rpc = new CustomRPC(networkName, chainId)
  const provider = rpc.getProvider()
  if (provider == null) return null;

  return new Proxy(provider, {
    get: function get(target, name, receiver) {

      if (name == 'getBlockWithTransactions') {
        console.log('I am extending getBlockWithTransactions')
        return Reflect.get(...arguments);
      }

      return Reflect.get(...arguments);
    }
  });
}

module.exports = { getProvider }
