let counter = 0

const providers = [
    'rpc1',
    'rpc2',
]

function getNextProviderIndex () {
    return counter % providers.length
}

function getProvider () {
    const nextProviderIndex = getNextProviderIndex()

    console.log(`provider counter: ${counter}`)
    console.log(`provider index: ${nextProviderIndex}`)
    console.log(`provider url: ${providers[nextProviderIndex]}`)

    counter++
}

module.exports = { getProvider }
