let callCount = 0
let callLog = []

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

module.exports = { logCall, callLog }
