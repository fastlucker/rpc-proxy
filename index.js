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

module.exports = { getProviderUrl }
