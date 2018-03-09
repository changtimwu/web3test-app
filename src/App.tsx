import * as React from 'react'
import './App.css'
import Web3 from 'web3'
import * as W3T from 'web3/types'
import getWeb3 from './lib/getWeb3'
import BN from 'bn.js'

import { Balance, Accounts } from './Accounts'
import { EthInfo, InfoEntry } from './EthInfo'
import { SignModule, MicroProof } from './lib/w3utils'
const logo = require('./logo.svg')

interface State {
  balances: Balance[]
  msgs: InfoEntry
}

class App extends React.Component<{}, State> {
  static readonly accounts = [
    '0x28a9ad1f490b346a19998277d1dd5dff7d9f7919',
    '0xba0be5ee5cfd3c421807bb00f55e98961b0eb5eb',
    '0x2df3f277f3f2da7783085cd7bc9d38448acc02bf'
  ]
  static readonly privKeys = [
    '6d1fb3fc6a4ed13f26e35c736c25d6642c11f25db7775cd535c8a59f18614a81',
    'e6a9e49b2feb0a11e6876e4464a7974bb9cb567c9af2cc38c02630717e7daa4b',
    '6b0d3fe37dc3d9ecbe359b38c60413db6a4ee0d37315b7d62e995103d32eadf7'
  ]
  web3: Web3
  constructor(props: {}) {
    super(props)
    this.state = { balances: [], msgs: {} }
  }
  async acctInfo() {
    let eth = this.web3.eth
    let accts = await eth.getAccounts()
    if (accts.length <= 1) {
      console.log(`${App.accounts.length} hardcode accounts`)
      accts = App.accounts
    }
    let balances: Balance[] = []
    for (let acct of accts) {
      let bal = await eth.getBalance(acct)
      let baleth = this.web3.utils.fromWei(bal, 'ether')
      // console.log(`${acct} ${baleth} ethers`)
      balances.push({ address: acct, val: parseInt(baleth as string, 10) })
    }
    this.setState({ balances })
  }
  async initAccount() {
    let w3 = await getWeb3()
    this.web3 = w3.web3Instance
    let eth = this.web3.eth
    let coinbase = await eth.getCoinbase()
    eth.defaultAccount = coinbase
    console.log('coinbase=', coinbase) // getCoinbase cause excpetion when infura as a provider
  }
  async netInfo() {
    let net = this.web3.eth.net
    let peercnts = await net.getPeerCount()
    // console.log('peer counts=', peercnts)
    let nettype = await net.getNetworkType()
    // console.log('network type=', nettype)
    let msgs = this.state.msgs
    msgs.peercnts = peercnts
    msgs.nettype = nettype
    this.setState({ msgs })
  }
  async ethsysInfo() {
    let eth = this.web3.eth
    let msgs = this.state.msgs
    msgs.defaultBlock = eth.defaultBlock
    msgs.defaultAccount = eth.defaultAccount
    msgs.protocolVersion = await eth.getProtocolVersion()
    msgs.isSyncing = (await eth.isSyncing()) ? 'Yes' : 'No'
  }
  async testSend(receiver: string) {
    let opts = { to: receiver, value: this.web3.utils.toWei('1', 'ether').toString() }
    let receipt = await this.web3.eth.sendTransaction(opts)
    console.log('receipt=', receipt)
    this.acctInfo()
  }
  async showInfo() {
    // this.meAcct = this.web3.eth.accounts.privateKeyToAccount(App.privKeys[0])
    await this.netInfo()
    await this.ethsysInfo()
    await this.acctInfo()
  }
  async testSign() {
    let s = new SignModule(this.web3)
    let sig = await s.signData({ balance: new BN(30), sig: '' })
    console.log('sig=', sig)
  }
  render() {
    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">Welcome to Plasma Payment testbed</h1>
        </header>
        <p className="App-intro">
          To get started, edit <code>src/App.tsx</code> and save to reload.
        </p>
        <button onClick={e => this.initAccount()} > Init Account</button>
        <button onClick={e => this.showInfo()} > Show Info</button>
        <button onClick={e => this.testSend(App.accounts[1])} >Test Send</button>
        <button onClick={e => this.testSign()} >Test Sign</button>
        <EthInfo ethinfo={this.state.msgs} />
        <Accounts balances={this.state.balances} />
      </div>
    );
  }
}

export default App;
