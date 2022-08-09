module.exports = {
    ethereum: {
      RPCs: [
        {url: 'https://eth-mainnet.alchemyapi.io/v2/e5Gr8LP_EH0SBPZiNCcC08OuEDrvgoYK', tags: []},
        {url: 'https://mainnet.infura.io/v3/d4319c39c4df452286d8bf6d10de28ae', tags: ['getLogs','eth_getLogs']},
        {url: 'wss://mainnet.infura.io/ws/v3/d4319c39c4df452286d8bf6d10de28ae', tags: ['getLogs','eth_getLogs']},
        {url: 'wss://damp-dark-glitter.quiknode.io/49f9362b-7916-4787-b1ff-c0d18c950af5/5KrreVw4iTHKwwsdjGpkMLVFHTtMV9oezITi6Knye6kmU89-ra1fo0oDrXhgvoI4yXnhwXah-Dgf1IgjWQOEQQ==/', tags: []}
      ],
      chainId: 1
    },
    polygon: {
      RPCs: [
        {url: 'https://polygon-rpc.com/rpc', tags: ['call','eth_sendRawTransaction']},
        {url: 'https://rpc.ankr.com/polygon', tags: ['call']},
        {url: 'https://rpc-mainnet.maticvigil.com/v1/06814f257d827f1312121b86e8b052d39b9f7ac0', tags: ['getLogs','eth_getLogs']},
        {url: 'wss://rpc-mainnet.maticvigil.com/ws/v1/06814f257d827f1312121b86e8b052d39b9f7ac0', tags: []},
        {url: 'https://polygon-mainnet.infura.io/v3/3d22938fd7dd41b7af4197752f83e8a1', tags: ['getLogs','eth_getLogs']},
        {url: 'https://polygon-mainnet.g.alchemy.com/v2/bOy_ofgTMoJ_KEsJwjwk2HZWDwSYy5pj', tags: []}
      ],
      chainId: 137
    }
  }