// define a cacheable DNS lookup for all the requests in the app
const http = require('http')
const https = require('https')
const { URL } = require('url')
const CacheableLookup = require('cacheable-lookup');

class MyCacheableLookup extends CacheableLookup {
    constructor(options = {}, cacheableHostnames = []) {
        super(options)

        this.cacheableHostnames = cacheableHostnames
    }

    async query(hostname) {
        if (this.cacheableHostnames.includes(hostname)) {
            return super.query(hostname)
        }

        // console.log(`--------- LOOKUP no cache for: ${hostname}`)
        const result = await this._dnsLookup(hostname, {all: true})
        const source = 'query'
        return result.map(entry => {
            return {...entry, source}
        })
    }
}

function init (_providersConfig) {
    let cacheableHostnames = []
    for (const network in _providersConfig) {
        const networkRPChostnames = _providersConfig[network]['RPCs'].map(rpc => (new URL(rpc.url)).hostname)
        cacheableHostnames = cacheableHostnames.concat(networkRPChostnames)
    }

    const cacheable = new MyCacheableLookup({
        maxTtl: 60 * 60 * 2
    }, cacheableHostnames);

    cacheable.install(http.globalAgent)
    cacheable.install(https.globalAgent)
}

module.exports = { init }
