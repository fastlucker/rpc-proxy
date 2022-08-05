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

  getBlockWithTransactions(blockHashOrBlockTag) {
    console.log('I am extending getBlockWithTransactions')
    return this.provider.getBlockWithTransactions(blockHashOrBlockTag)
  }

  // send(method, params) {
  //   console.log('I am extending send')
  //   return this.provider.send(method, params)
  // }
}

function getProvider(networkName, chainId) {
  const rpc = new CustomRPC(networkName, chainId)
  if (rpc.getProvider() == null) return null;

  return new Proxy(rpc, {
    get: function get(target, name) {
      return function wrapper() {

        // if we want to extend/override explicity the method,
        // we do so here
        if (typeof(rpc[name]) == 'function') {
          return rpc[name](...arguments)
        }

        // if we want just want to proceed with the normal exec,
        // we pass it on to the original provider
        const provider = rpc.getProvider()
        if (typeof(provider[name]) == 'function') {
          console.log(name)
          return provider[name](...arguments)
        }
      }
    }
  });
}

module.exports = { getProvider }
