const customRPC = require('../')
const rpcCallLogger = require('./../src/utils/rpc-call-logger')
const assert = require('assert')
const { delay } = require('./_helper')

let provider

const networks = {
    polygon: {
        RPCs: [
            {url: 'http://url1', tags: ['call','eth_sendRawTransaction']},
            {url: 'http://url2', tags: ['call']},
            {url: 'wss://url3', tags: ['getLogs','eth_getLogs']},
            {url: 'wss://url4', tags: ['call']},
        ],
        chainId: 137,
        title: 'Polygon'
    }
}
const network = 'polygon'
const chainId = networks[network].chainId

jest.mock('cacheable-lookup')
jest.mock('http')
jest.mock('https')
jest.mock('ws')
jest.mock('redis', () => {
    return {
        createClient: jest.fn().mockImplementation(() => {
            return {
                get: jest.fn(),
                set: jest.fn(),
                send_command: jest.fn(),
                subscribe: jest.fn(),
                on: jest.fn(),
            }
        })
    }
})

beforeAll(async () => {
    return delay().then(() => {
        customRPC.init(networks)
        provider = customRPC.getProvider(network)
    })
})

afterAll(async () => {
    return delay().then(() => {
        provider.off('block')
    })
})

test('test if chain id is returning cached result', async () => {
	const result1 = await provider.send('eth_chainId', [ ])
    assert(parseInt(result1) === chainId, 'Expected chain id is OK')
    const callLog1 = rpcCallLogger.callLog[rpcCallLogger.callLog.length - 1]
    assert(callLog1.cached === true, 'Expected cached result')

    const result2 = await provider.send('eth_chainId', [ ])
    assert(parseInt(result2) === chainId, 'Expected chain id is OK')
    const callLog2 = rpcCallLogger.callLog[rpcCallLogger.callLog.length - 1]
    assert(callLog2.cached === true, 'Expected cached result')

    // result was cached, yet chosen providers should have been rotated
    assert(callLog1.providerUrl != callLog2.providerUrl, 'Expected providers to be rotated')
})

test('test emitting block events and check latest-block', async () => {
    const testCallback = jest.fn()
    provider.on('latest-block', (blockNum) => {
        testCallback(blockNum)
    })

    provider.emit('block', 101)
    await delay()
    expect(testCallback).toHaveBeenCalledTimes(1)
    expect(testCallback).toHaveBeenLastCalledWith(101)

    provider.emit('block', 102)
    await delay()
    expect(testCallback).toHaveBeenCalledTimes(2)
    expect(testCallback).toHaveBeenLastCalledWith(102)

    provider.off('latest-block')
})
