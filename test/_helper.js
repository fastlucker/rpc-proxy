async function delay(timeout = 50) {
    return new Promise(resolve => setTimeout(resolve, timeout))
}

module.exports = { delay }
