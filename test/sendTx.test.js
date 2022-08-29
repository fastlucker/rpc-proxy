const customRPC = require('../')
const { delay } = require('./_helper')

let provider

const network = 'polygon'
const networks = {
    polygon: {
        RPCs: [
            {url: 'http://url1', tags: ['call','eth_sendRawTransaction']},
            {url: 'http://url1', tags: ['call']},
            {url: 'wss://url3', tags: ['getLogs','eth_getLogs']},
            {url: 'wss://url4', tags: ['call']},
        ],
        chainId: 137,
        title: 'Polygon'
    }
}

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
const getProviderMock = (_providerIndex) => {
    return () => {
        const providerUrl = networks[network].RPCs[_providerIndex]
            ? networks[network].RPCs[_providerIndex].url
            : 'http://default'

        return {
            connection: {
                url: providerUrl
            },
            _network: {
                chainId: networks[network].chainId
            },
            on: jest.fn(),
            once: jest.fn(),
            off: jest.fn(),
            send: jest.fn()
        }
    }
}
jest.mock('ethers', () => {
    return {
        providers: {
            StaticJsonRpcProvider: jest.fn(getProviderMock())
                .mockImplementationOnce(getProviderMock(0))
                .mockImplementationOnce(getProviderMock(1)),
            WebSocketProvider: jest.fn(getProviderMock())
                .mockImplementationOnce(getProviderMock(2))
                .mockImplementationOnce(getProviderMock(3)),
        }
    }
})

beforeAll(async () => {
    return delay().then(() => {
        customRPC.init(networks)
        provider = customRPC.getProvider(network)
    })
})

test('test if eth_sendRawTransaction returns the tagged provider as it should', async () => {
	await provider.send('eth_sendRawTransaction')
    const callLog1 = customRPC.callLog[customRPC.callLog.length - 1]
    expect(callLog1.providerUrl).toBe('http://url1')

    await provider.send('eth_sendRawTransaction')
    const callLog2 = customRPC.callLog[customRPC.callLog.length - 1]
    expect(callLog2.providerUrl).toBe('http://url1')
})
