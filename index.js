const { ProviderStore } = require('./provider-store')
const proxyBuilder = require('./proxy-builder')
const dnslookup = require('./utils/dnslookup')
const redis = require("redis")

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const redisClient = redis.createClient(redisUrl);

let providerStore

function init (_providersConfig, _connectionParams = {}) {
  dnslookup.init(_providersConfig)

  providerStore = new ProviderStore(redisClient, _providersConfig, _connectionParams)

  //.: Activate "notify-keyspace-events" for expired type events
  redisClient.send_command('config', ['set','notify-keyspace-events','Ex'], SubscribeExpired)

  //.: Subscribe to the "notify-keyspace-events" channel used for expired type events
  function SubscribeExpired(e,r) {
    const redisClientSub = redis.createClient(redisUrl);
    const expired_subKey = '__keyevent@0__:expired'
    redisClientSub.subscribe(expired_subKey, function() {
      console.log(' [i] Subscribed to "'+expired_subKey+'" event channel : '+r)
      redisClientSub.on('message', function (chan,msg) {
        if (! msg.includes('_split_key_here_')) {
          return
        }

        const network = msg.split('_split_key_here_')[0]
        const url = msg.split('_split_key_here_')[1]
        console.log('[expired]', 'Network: ' + network, 'Provider: ' + url)

        providerStore.resetProviderRating(network, url)
      })
    })
  }
}

function getProvider(networkName) {
  if (! providerStore.isInitialized()) throw new Error('CustomRPC error. Provider store not initialized')
  // if (! providerStore.byNetwork[networkName]) return null

  return proxyBuilder.buildProxy(providerStore, networkName)
}

module.exports = { init, getProvider }
