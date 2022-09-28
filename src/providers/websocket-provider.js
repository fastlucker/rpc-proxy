const { WebSocketProvider } = require('ethers').providers

class MyWebSocketProvider extends WebSocketProvider {
    _startEvent(event) {
        // this is just to prevent WebSocketProvider from console.logging
        // a warning for our custom event 'latest-block'
        if (event.type == 'latest-block') {
            return
        }

        super._startEvent(event)
    }
}

module.exports = { MyWebSocketProvider }
