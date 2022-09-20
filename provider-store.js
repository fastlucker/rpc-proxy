const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

const byNetwork = {}
const byNetworkCounter = {}
const byNetworkLatestBlock = {}

let finalConnectionParams

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
    providerStore.byNetwork[networkName].map((info, index) => {
        providerStore.byNetwork[networkName][index].provider = connect(info.url, networkName, info.chainId, connectionParams)
    })
}

module.exports = {
    byNetwork,
    byNetworkCounter,
    byNetworkLatestBlock,
    connect,
    reconnectAllByNetwork
}
