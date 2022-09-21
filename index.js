const providerStore = require('./provider-store')
const proxyBuilder = require('./proxy-builder')
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

    providerStore.byNetwork[network].filter(info => info.url == url)[0].rating = defaultRating
  })
 })
}

function init (_providersConfig, _connectionParams = {}) {
  dnslookup.init(_providersConfig)

  // override default connection params if provided as input
  finalConnectionParams = Object.assign(defaultConnectionParams, _connectionParams);

  for (const network in _providersConfig) {
    const chainId = _providersConfig[network]['chainId']
    providerStore.byNetwork[network] = []
    providerStore.byNetworkCounter[network] = 1
    providerStore.byNetworkLatestBlock[network] = 0

    for (let providerInfo of _providersConfig[network]['RPCs']) {
      const providerUrl = providerInfo['url']
      const provider = providerStore.connect(providerUrl, network, chainId, finalConnectionParams)

      providerStore.byNetwork[network].push({
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

        providerStore.byNetwork[network].filter(info => info.url == providerUrl)[0].rating = value
      })

      provider.on('block', async function (blockNum) {
        if (blockNum <= providerStore.byNetworkLatestBlock[network]) return

        providerStore.byNetworkLatestBlock[network] = blockNum
        provider.emit('latest-block', blockNum)
      })
    }
  }
}

function getProvider(networkName) {
  if (Object.keys(providerStore.byNetwork).length === 0) throw new Error('CustomRPC not initialized')
  if (! providerStore.byNetwork[networkName]) return null

  return proxyBuilder.buildProxy(networkName)
}

// get the key we are using in redis for the rating
function getRatingKey(network, url) {
  return network + '_split_key_here_' + url
}

module.exports = { init, getProvider }
