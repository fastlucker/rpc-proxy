const { StaticJsonRpcProvider, WebSocketProvider } = require('ethers').providers
const { Logger } = require('@ethersproject/logger')
const dnslookup = require('./utils/dnslookup')
const redis = require("redis")
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const redisClient = redis.createClient(redisUrl);
const defaultRating = 100

const defaultConnectionParams = {timeout: 5000, throttleLimit: 2, throttleSlotInterval: 10}
let finalConnectionParams

//.: Activate "notify-keyspace-events" for expired type events
redisClient.send_command('config', ['set','notify-keyspace-events','Ex'], SubscribeExpired)

//.: Subscribe to the "notify-keyspace-events" channel used for expired type events
function SubscribeExpired(e,r){
 const redisClientSub = redis.createClient(redisUrl);
 const expired_subKey = '__keyevent@0__:expired'
 redisClientSub.subscribe(expired_subKey, function(){
  console.log(' [i] Subscribed to "'+expired_subKey+'" event channel : '+r)
  redisClientSub.on('message', function (chan,msg){
    if (! msg.includes('_split_key_here_')) {
      return
    }

    const network = msg.split('_split_key_here_')[0]
    const url = msg.split('_split_key_here_')[1]
    console.log('[expired]', 'Network: ' + network, 'Provider: ' + url)

    byNetwork[network].filter(info => info.url == url)[0].rating = defaultRating
  })
 })
}

const byNetwork = {}
const byNetworkCounter = {}
let callCount = 0
let callLog = []
const byNetworkLatestBlock = {}

function logCall(provider, propertyOrMethod, args, cached = false, res = null) {
  callLog.push({
    id: callCount,
    providerUrl: provider ? provider.connection.url : null,
    propertyOrMethod: propertyOrMethod,
    args: args,
    cached: cached,
    response: res
  })
  callCount++
  callLog = callLog.length > 50 ? callLog.slice(-50) : callLog
}

function init (_providersConfig, _connectionParams = {}) {
  dnslookup.init(_providersConfig)

  // override default connection params if provided as input
  finalConnectionParams = Object.assign(defaultConnectionParams, _connectionParams);

  for (const network in _providersConfig) {
    const chainId = _providersConfig[network]['chainId']
    byNetwork[network] = []
    byNetworkCounter[network] = 1
    byNetworkLatestBlock[network] = 0

    for (let providerInfo of _providersConfig[network]['RPCs']) {
      const providerUrl = providerInfo['url']
      const provider = connect(providerUrl, finalConnectionParams, network, chainId)

      byNetwork[network].push({
        url: providerUrl,
        provider: provider,
        tags: providerInfo['tags'],
        chainId: chainId,
        rating: defaultRating
      })

      // this is async, will not load immediatelly.
      // If there is a cached rating for the provider, set it
      redisClient.get(getRatingKey(network, providerUrl), function (err, value) {
        if (!value) return

        byNetwork[network].filter(info => info.url == providerUrl)[0].rating = value
      })

      provider.on('block', async function (blockNum) {
        if (blockNum <= byNetworkLatestBlock[network]) return

        byNetworkLatestBlock[network] = blockNum
        provider.emit('latest-block', blockNum)
      })
    }
  }
}

function connect(providerUrl, connectionParams, network, chainId) {
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

function getProvider(networkName) {
  if (Object.keys(byNetwork).length === 0) throw new Error('CustomRPC not initialized')
  if (! byNetwork[networkName]) return null

  return new Proxy({}, {
    get: function get(target, prop, receiver) {

      if (prop == 'restart') {
        console.log(`[${new Date().toLocaleString()}] restarted`)

        // restart all the providers in the network
        byNetwork[networkName].map((info, index) => {
          byNetwork[networkName][index].provider = connect(info.url, finalConnectionParams, networkName, info.chainId)
        })
        return
      }

      // target only the send function as the send function
      // is the one calling eth_call, eth_sendTransaction
      if (typeof(byNetwork[networkName][0].provider[prop]) == 'function') {
        return async function() {
          return handleTypeFunction(networkName, prop, arguments)
        }
      }

      return handleTypeProp(networkName, prop, arguments)
    },
    set: function(target, prop, value) {
      return handleTypePropSet(networkName, prop, value)
    }
  })
}

function chooseProvider(networkName, propertyOrMethod, sendMethodFirstArgument, failedProviders = []) {
  // console.log(`--- Called method and args: ${propertyOrMethod} ${arguments}`)

  // plan
  // search the tags for the passed propertyOrMethod.
  // if nothing is found, check if propertyOrMethod is send.
  // if it is send, search the tags for arguments[0] (eth method name)
  // if nothing is found, rotate
  // if found in all providers, rotate
  // if found in 0 < x < max providers, set one of those providers

  const networkRPCs = byNetwork[networkName]

  let validRPCs = networkRPCs.filter(i => i['tags'].includes(propertyOrMethod))
  if (validRPCs.length == 0 && propertyOrMethod == 'send') {
    validRPCs = networkRPCs.filter(i => i['tags'].includes(sendMethodFirstArgument))
  }

  const uniqueFailedProviderUrls = [...new Set(failedProviders.map(provider => provider.connection.url))]

  // if there are no specific providers, set them back to all.
  // or... if we hit the fallback mechanism and all the specific
  // RPCs for this request failed, just choose one of all possible.
  if (
    validRPCs.length == 0
    || (
      uniqueFailedProviderUrls.length > 0
      && validRPCs.length == uniqueFailedProviderUrls.length
      && validRPCs.filter(rpc => uniqueFailedProviderUrls.includes(rpc.url)).length == uniqueFailedProviderUrls.length
    )
  ) {
    // try to exclude the failed RPCs... but if there are no other RPCs
    // available, we have no choice except to try again with the failed one
    if (uniqueFailedProviderUrls.length > 0) {
      validRPCs = networkRPCs.filter(rpc => ! uniqueFailedProviderUrls.includes(rpc.url))
    }
    if (validRPCs.length == 0) validRPCs = networkRPCs
  }

  // take the ones with the highest ratings only and rotate them
  validRPCs = getProvidersWithHighestRating(validRPCs)
  return roundRobbinRotate(networkName, validRPCs)
}

function roundRobbinRotate(networkName, singleNetworkRPCs) {
  const currentIndex = getCurrentProviderIndex(networkName, singleNetworkRPCs);
  byNetworkCounter[networkName]++;

  const urls = singleNetworkRPCs.map(rpc => rpc.url)
  return byNetwork[networkName].filter(info => urls.includes(info.url))[currentIndex].provider
}

// return only the providers that have the highest rating
function getProvidersWithHighestRating(singleNetworkProviders) {
  const sorted = singleNetworkProviders.sort(function(a, b) {
    return b.rating - a.rating
  })

  // console.log(`--- ratings: ${sorted.map(p => `(url: ${p.url}, rating: ${p.rating})`)}`)
  const highest = sorted[0].rating
  return sorted.filter(one => {
    return one.rating == highest
  })
}

function getCurrentProviderIndex (network, filteredProviders = []) {
  const finalProviders = filteredProviders.length
    ? filteredProviders
    : byNetwork[network]['RPCs']

  return byNetworkCounter[network] % finalProviders.length
}

// The function handler try block
async function handleTypeFunction(networkName, prop, args, failedProviders = []) {
  // special treatment for these methods calls, related to event subscribe/unsubscribe
  if (['on', 'once', 'off'].includes(prop)) {
    const _providers = byNetwork[networkName].map(p => p.provider)
    for (const _provider of _providers) {
      _provider[prop]( ...args )
      logCall(_provider, prop, args)
    }
    return
  }

  const provider = chooseProvider(networkName, prop, args[0], failedProviders)
  console.log(`--- ${networkName} - ${provider.connection.url} --- method and args: ${prop} ${args} --- retries: ${failedProviders.length}`)

  try {
    // simulate/return chain id without making an RPC call
    if (prop === 'send' && args[0] === 'eth_chainId') {
      result = `0x${provider._network.chainId.toString(16)}`
      logCall(provider, prop, args, true, result)
      return result
    }

    // #buggy: fixup argument if 'getBlock' or 'getBlockWithTransactions' are called
    // related to this discussion: https://github.com/ethers-io/ethers.js/discussions/3072
    if (['getBlock', 'getBlockWithTransactions'].includes(prop)) {
      args[0] = args[0] == -1 ? 'latest' : args[0]
    }

    result = provider[prop]( ...args )

    if (typeof result === 'object' && typeof result.then === 'function') {

      if (networkName == 'polygon' && prop == 'send' && args[0] === 'eth_sendRawTransaction') {
        console.log('FOR eth_sendRawTransaction: ' + provider.connection.url)
      }

      result = await result
      logCall(provider, prop, args, false, result)
      return new Promise(resolve => resolve(result))
    }
    logCall(provider, prop, args, false, result)
    return result

  } catch (e) {
    lowerProviderRating(networkName, provider)
    failedProviders.push(provider)
    checkFailLimit(e, failedProviders)
    return handleTypeFunction(networkName, prop, args, failedProviders)
  }
}

// The property handler try block.
// The difference is that the tryBlock is an async function while this one is not
function handleTypeProp(networkName, prop, args, failedProviders = []) {
  const provider = chooseProvider(networkName, prop, args[0], failedProviders)
  console.log(`--- ${networkName} - ${provider.connection.url} --- property: ${prop} --- retries: ${failedProviders.length}`)

  try {
    result = provider[prop]
    logCall(provider, prop, args, false, result)
    return result
  } catch (e) {
    lowerProviderRating(networkName, provider)
    failedProviders.push(provider)
    checkFailLimit(e, failedProviders)
    return handleTypeProp(networkName, prop, args, failedProviders)
  }
}

function handleTypePropSet(networkName, prop, value) {
  // when setting a property, we would want to set it to all providers for this network
  const _providers = byNetwork[networkName].map(p => p.provider)
  for (const _provider of _providers) {
    try {
      _provider[prop] = value
      logCall(_provider, prop, value)
    } catch (e) {
      // not all provider types support all properties, so this is an expected error
      if (e.code === Logger.errors.UNSUPPORTED_OPERATION) continue
      throw e
    }
  }
}

function checkFailLimit(e, failedProviders) {
  // MAX: the number of fallbacks we want to have
  if (failedProviders.length > 1) {
    throw e;
  }
}

function lowerProviderRating(networkName, provider) {
  // lower the rating
  byNetwork[networkName].map((object, index) => {
    if (object.url == provider.connection.url) {
      byNetwork[networkName][index].rating = byNetwork[networkName][index].rating - 1

      redisClient.set(
        getRatingKey(networkName, provider.connection.url),
        byNetwork[networkName][index].rating,
        'EX',
        60 * 5
      );
    }
  })
}

// get the key we are using in redis for the rating
function getRatingKey(network, url) {
  return network + '_split_key_here_' + url
}

module.exports = { init, getProvider, callLog }
