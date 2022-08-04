const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers

let counter = 0

const providers = {
    polygon: [
        'https://polygon-rpc.com/rpc',
        'https://rpc.ankr.com/polygon',
    ]
}

function getNextProviderIndex (network) {
    counter++
    return counter % providers[network].length
}

function getProviderUrl (network) {
    const nextProviderIndex = getNextProviderIndex(network)

    console.log(`provider counter: ${counter}`)
    console.log(`provider index: ${nextProviderIndex}`)
    console.log(`provider url: ${providers[network][nextProviderIndex]}`)

    return providers[network][nextProviderIndex]
}

function getProvider (networkName, chainId) {
    if (networkName !== 'polygon') return null;

    const url = getProviderUrl(networkName)
	const provider = url.startsWith('wss:')
        ? new WebSocketProvider(url, { networkName, chainId })
        : new StaticJsonRpcProvider(url, { networkName, chainId })

	if (provider) {
		provider.on('error', function (e) {
			console.error(`[${new Date().toLocaleString()}] RPC "[${url}]" return error`, e)
		})
	}

	if (provider && provider._websocket && provider._websocket.on) {
		provider._websocket.on('error', function (e) {
			console.error(`[${new Date().toLocaleString()}] provider RPC "[${url}]" return socket error`, e)
		})
	}

	return provider
}

module.exports = { getProvider }
