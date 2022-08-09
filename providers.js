module.exports = {
    ethereum: {
      RPCs: [
        {url: 'https://eth-mainnet.alchemyapi.io/v2/e5Gr8LP_EH0SBPZiNCcC08OuEDrvgoYK', tags: []},
        {url: 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae', tags: ['getLogs','eth_getLogs']},
        {url: 'wss://mainnet.infura.io/ws/v3/d4319c39c4df452286d8bf6d10de28ae', tags: ['getLogs','eth_getLogs']}  
      ],
      chainId: 1
    },
    polygon: {
      RPCs: [
        {url: 'https://polygon-rpc.com/rpc', tags: ['call','eth_sendRawTransaction','getLogs','eth_getLogs']},
        {url: 'https://rpc.ankr.com/polygon', tags: ['call']}
      ],
      chainId: 137
    }
  }