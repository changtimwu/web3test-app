// import store from '../../store'
import Web3 from 'web3'
export const WEB3_INITIALIZED = 'WEB3_INITIALIZED'

export interface W3InitResult {
  web3Instance: Web3
}

/*
function web3Initialized(results: W3InitResult) {
  return {
    type: WEB3_INITIALIZED,
    payload: results
  }
}*/

let Web3Prom = new Promise<W3InitResult>((resolve, reject) => {
  // Wait for loading completion to avoid race conditions with web3 injection timing.
  window.addEventListener('load', (dispatch) => {
    var results: W3InitResult
    var win = window as { web3?: { currentProvider: any } }
    // Checking if Web3 has been injected by the browser (Mist/MetaMask)
    if (win.web3) {
      // Use Mist/MetaMask's provider.
      let w3inst = new Web3(win.web3.currentProvider)
      results = {
        web3Instance: w3inst
      }
      console.log('Injected web3 detected.')
      resolve(results)
    } else {
      // Fallback to localhost if no web3 injection. We've configured this to
      // use the development console's port by default.
      var provider = new Web3.providers.HttpProvider('http://127.0.0.1:9545')
      let web3 = new Web3(provider)
      results = {
        web3Instance: web3
      }
      console.log('No web3 instance injected, using Local web3.')
      resolve(results)
    }
    return results
  })
})

let getWeb3 = () => {
  return Web3Prom
}

export default getWeb3
