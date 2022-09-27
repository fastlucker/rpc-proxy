// define a cacheable DNS lookup for all the requests in the app
const http = require('http')
const https = require('https')
const { URL } = require('url')
const CacheableLookup = require('cacheable-lookup');

// in seconds
const defaultCacheTTL = 60 * 60 * 2 

class MyCacheableLookup extends CacheableLookup {
    constructor(options = {}, cacheableHostnames = []) {
        super(options)

        this.cacheableHostnames = cacheableHostnames
    }

    async query(hostname) {
        // cached lookup
        if (this.cacheableHostnames.includes(hostname)) {
            return super.query(hostname)
        }

        // normal lookup (not cached)
        const result = await this._dnsLookup(hostname, {all: true})
        const source = 'query'
        return result.map(entry => {
            return {...entry, source}
        })
    }
}

function init (_providersConfig, _dnsCacheTTL = null) {
    let cacheableHostnames = []
    for (const network in _providersConfig) {
        const networkRPChostnames = _providersConfig[network]['RPCs'].map(rpc => (new URL(rpc.url)).hostname)
        cacheableHostnames = cacheableHostnames.concat(networkRPChostnames)
    }

    const cacheable = new MyCacheableLookup({
        maxTtl: _dnsCacheTTL === null ? defaultCacheTTL : parseInt(_dnsCacheTTL)
    }, cacheableHostnames);

    cacheable.install(http.globalAgent)
    cacheable.install(https.globalAgent)
}

module.exports = { init }
