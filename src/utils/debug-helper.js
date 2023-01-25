let debug = false
let isSilent = false

function setDebug(value, silent) {
    debug = value
    isSilent = silent
}

function printLog(message = '', force = false) {
    if (isSilent || !(force || debug)) return

    console.log(`[RPC Proxy] [${new Date().toLocaleString()}] ${message}`)
}

module.exports = { setDebug, printLog }
