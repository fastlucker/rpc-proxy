let debug = false

function setDebug(value) {
    debug = value
}

function printLog(message = '', force = false) {
    if (!(force || debug)) return

    console.log(`[RPC Proxy] [${new Date().toLocaleString()}] ${message}`)
}

module.exports = { setDebug, printLog }
