import Web3 from 'web3';
import * as W3T from 'web3/types';
import BigNumber from 'bn.js'
import { typedSignatureHash, recoverTypedSignature, TypedData } from 'eth-sig-util';
export { BigNumber };

// helper types

/**
 * [[MicroChannel.proof]] data type
 */
export interface MicroProof {
  /**
   * Balance value, shifted by token decimals
   */
  balance: BigNumber;
  /**
   * Balance signature
   */
  sig?: string;
}

/**
 * [[MicroRaiden.channel]] state data blueprint
 */
export interface MicroChannel {
  /**
   * Sender/client's account address
   */
  account: string;
  /**
   * Receiver/server's account address
   */
  receiver: string;
  /**
   * Open channel block number
   */
  block: number;
  /**
   * Current balance proof
   */
  proof: MicroProof;
  /**
   * Next balance proof, persisted with [[MicroRaiden.confirmPayment]]
   */
  next_proof?: MicroProof;
  /**
   * Cooperative close signature from receiver
   */
  closing_sig?: string;
}

/**
 * [[MicroRaiden.getChannelInfo]] result
 */
export interface MicroChannelInfo {
  /**
   * Current channel state, one of 'opened', 'closed' or 'settled'
   */
  state: string;
  /**
   * Block of current state (opened=open block number,
   * closed=channel close requested block number, settled=settlement block number)
   */
  block: number;
  /**
   * Current channel deposited sum
   */
  deposit: BigNumber;
  /**
   * Value already taken from the channel
   */
  withdrawn: BigNumber;
}

/**
 * [[MicroRaiden.getTokenInfo]] result
 */
export interface MicroTokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  balance: BigNumber;
}

/**
 * ChannelCreated event arguments
 */
interface ChannelCreatedArgs {
  _sender_address: string;
  _receiver_address: string;
}

/**
 * ChannelCloseRequested event arguments
 */
interface ChannelCloseRequestedArgs {
  _sender_address: string;
  _receiver_address: string;
  _open_block_number: BigNumber;
}

/**
 * ChannelSettled event arguments
 */
interface ChannelSettledArgs {
  _sender_address: string;
  _receiver_address: string;
  _open_block_number: BigNumber;
}

class FundError extends Error {
  current: BigNumber
  required: BigNumber
}
/**
 * Async sleep: returns a promise which will resolve after timeout
 *
 * @param timeout  Timeout before promise is resolved, in milliseconds
 * @returns  Promise which will be resolved after timeout
 */
export function asyncSleep(timeout: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

/**
 * Encode strings and numbers as hex, left-padded, if required.
 *
 * 0x prefix not added,
 *
 * @param val  Value to be hex-encoded
 * @param zPadLength  Left-pad with zeroes to this number of characters
 * @returns  hex-encoded value
 * TODO: The builtin function `padStart` is only supported in ES2017.
 */
export function encodeHex(val: string | number | BigNumber, zPadLength?: number): string {
  /* Encode a string or number as hexadecimal, without '0x' prefix */
  if (typeof val === 'number' || val instanceof BigNumber) {
    val = val.toString(16);
  } else {
    val = Array.from(val as string).map((char: string) =>
      char.charCodeAt(0).toString(16).padStart(2, '0')
    ).join('');
  }
  return val.padStart(zPadLength || 0, '0');
}

/**
 * Main MicroRaiden client class
 *
 * Contains all methods to interact with a MicroRaiden channel through a web3
 * instance.
 */
export class MicroRaiden {

  /**
   * Web3 instance
   */
  web3: Web3;
  /**
   * Currently set channel info. May be loaded through [[loadStoredChannel]],
   * [[loadChannelFromBlockchain]], or stored and set manually with [[setChannel]]
   */
  channel: MicroChannel;
  /**
   * Token contract instance
   */
  token: W3T.Contract;
  /**
   * Channel manager contract instance
   */
  contract: W3T.Contract;
  /**
   * Token decimals
   */
  decimals: number = 0;
  /**
   * Challenge period for uncooperative close, setup in channel manager
   */
  challenge: number = 0;
  /**
   * Block number in which channel manager was created, or before.
   * Just a hint to avoid [[loadChannelFromBlockchain]] to scan whole network
   * for ChannelCreated events, default to 0
   */
  startBlock: number;

  /**
   * MicroRaiden constructor
   *
   * @param web3  Web3 http url, or object with currentProvider property
   * @param contractAddr  Channel manager contract address
   * @param contractABI  Channel manager ABI
   * @param tokenAddr  Token address, must be the same setup in channel manager
   * @param tokenABI  Token ABI
   * @param startBlock  Block in which channel manager was deployed
   */
  constructor(
    provider: string | { currentProvider: W3T.Provider },
    contractAddr: string,
    contractABI: W3T.Contract[],
    tokenAddr: string,
    tokenABI: W3T.Contract[],
    startBlock?: number,
  ) {
    if (!provider) {
      provider = 'http://localhost:8545';
    }
    if (typeof provider === 'string') {
      this.web3 = new Web3(new Web3.providers.HttpProvider(provider));
    } else if (provider.currentProvider) {
      this.web3 = new Web3(provider.currentProvider);
    } else {
      throw new Error('Invalid web3 provider');
    }
    this.contract = new this.web3.eth.Contract(
      contractABI,
      contractAddr,
      { from: this.web3.eth.defaultAccount }
    )
    this.token = new this.web3.eth.Contract(tokenABI, tokenAddr);
    this.startBlock = startBlock || 0;
    this.channel = { account: '', receiver: '', block: 0, proof: { balance: new BigNumber(0) } }

  }
  // utils
  /**
   * Convert number to BigNumber
   *
   * Takes into account configured token, taking in account the token decimals
   *
   * @param value  Number or numeric-string to be converted
   * @returns  BigNumber representation of value * 10^decimals
   */
  num2tkn(value?: number | string): BigNumber {
    return new BigNumber(value || 0).muln(this.decimals);
  }

  /**
   * Convert BigNumber to number
   *
   * Takes into account configured token, taking in account the token decimals
   * Caution: it may add imprecisions due to javascript's native number limitations
   *
   * @param bal  Value to be converted
   * @returns  JS's native number representation of bal
   */
  tkn2num(bal: BigNumber): number {
    return new BigNumber(bal).muln(-this.decimals).toNumber();
  }

  /**
   * Get contract's configured challenge's period
   *
   * As it calls the contract method, can be used for validating that
   * contract's address has code in current network
   *
   * @returns  Promise to challenge period number, in blocks
   */
  async getChallengePeriod(): Promise<number> {
    this.challenge = await this.contract.methods.challenge_period().call()
    if (!(this.challenge > 0)) {
      throw new Error('Invalid challenge');
    }
    return this.challenge;
  }

  // instance methods

  /**
   * If localStorage is available, try to load a channel from it
   *
   * Indexed by given account and receiver
   *
   * @param account  Sender/client's account address
   * @param receiver  Receiver/server's account address
   * @returns  True if a channel data was found, false otherwise
   */
  loadStoredChannel(account: string, receiver: string): boolean {
    if (typeof localStorage === 'undefined') {
      delete this.channel;
      return false;
    }
    const key = [account, receiver].join('|');
    const value = localStorage.getItem(key);
    if (value) {
      const channel = JSON.parse(value);
      if (!channel || !channel.proof || !channel.proof.balance) {
        return false;
      }
      channel.proof.balance = new BigNumber(channel.proof.balance);
      if (channel.next_proof) {
        channel.next_proof.balance = new BigNumber(channel.next_proof.balance);
      }
      this.channel = channel;
      return true;
    } else {
      delete this.channel;
      return false;
    }
  }

  /**
   * Forget current channel and remove it from localStorage, if available
   */
  forgetStoredChannel(): void {
    if (!this.channel) {
      return;
    }
    if (typeof localStorage !== 'undefined') {
      const key = [this.channel.account, this.channel.receiver].join('|');
      localStorage.removeItem(key);
    }
    delete this.channel;
  }

  /**
   * Scan the blockchain for an open channel, and load it with 0 balance
   *
   * The 0 balance may be overwritten with [[setBalance]] if
   * server replies with a updated balance on first request.
   * It should ask user for signing the zero-balance proof
   * Throws/reject if no open channel was found
   *
   * @param account  Sender/client's account address
   * @param receiver  Receiver/server's account address
   * @returns  Promise to channel info, if a channel was found
   */
  async loadChannelFromBlockchain(account: string, receiver: string): Promise<MicroChannel> {
    const openEvents = await this.contract.getPastEvents(
      'ChannelCreated',
      {
        filter: { _sender_address: account, _receiver_address: receiver, },
        fromBlock: this.startBlock, toBlock: 'latest'
      }
    )

    if (!openEvents || openEvents.length === 0) {
      throw new Error('No channel found for this account');
    }
    const minBlock = Math.min.apply(null, openEvents.map((ev) => ev.blockNumber)) as number;
    const [closeEvents, settleEvents, currentBlock, challenge] = await Promise.all([
      this.contract.getPastEvents(
        'ChannelCloseRequested',
        {
          filter: { _sender_address: account, _receiver_address: receiver },
          fromBlock: minBlock, toBlock: 'latest'
        }
      ) as Promise<W3T.EventLog[]>,
      this.contract.getPastEvents(
        'ChannelSettled',
        {
          filter: { _sender_address: account, _receiver_address: receiver },
          fromBlock: minBlock, toBlock: 'latest'
        }
      ) as Promise<W3T.EventLog[]>,
      this.web3.eth.getBlockNumber(),
      this.getChallengePeriod(),
    ]);

    const stillOpen = openEvents.filter((ev) => {
      for (let sev of settleEvents) {
        let sevRet = sev.returnValues as ChannelCloseRequestedArgs
        if (sevRet._open_block_number.eqn(ev.blockNumber)) {
          return false;
        }
      }
      for (let cev of closeEvents) {
        let cevRet = cev.returnValues as ChannelSettledArgs
        if (cevRet._open_block_number.eqn(ev.blockNumber) &&
          ev.blockNumber + challenge > currentBlock) {
          return false;
        }
      }
      return true;
    });

    let openChannel: MicroChannel | null = null;
    for (let ev of stillOpen) {
      let channel: MicroChannel = {
        account,
        receiver,
        block: ev.blockNumber,
        proof: { balance: new BigNumber(0) },
      };
      try {
        await this.getChannelInfo(channel);
        openChannel = channel;
        break;
      } catch (err) {
        console.debug('Invalid channel', channel, err);
        continue;
      }
    }
    if (!openChannel) {
      throw new Error('No open and valid channels found from ' + stillOpen.length);
    }
    this.setChannel(openChannel);
    return this.channel;
  }

  /**
   * Set [[channel]] info
   *
   * Can be used to externally [re]store an externally persisted channel info
   *
   * @param channel  Channel info to be set
   */
  setChannel(channel: MicroChannel): void {
    this.channel = channel;
    if (typeof localStorage !== 'undefined') {
      const key = [this.channel.account, this.channel.receiver].join('|');
      localStorage.setItem(key, JSON.stringify(this.channel));
    }
  }

  /**
   * Health check for currently configured channel info
   *
   * @param channel  Channel to test. Default to [[channel]]
   * @returns  True if channel is valid, false otherwise
   */
  isChannelValid(channel?: MicroChannel): boolean {
    if (!channel) {
      channel = this.channel;
    }
    if (!channel || !channel.receiver || !channel.block
      || !channel.proof || !channel.account) {
      return false;
    }
    return true;
  }

  /**
   * Get available accounts from web3 providers
   *
   * @returns Promise to accounts addresses array
   */
  async getAccounts(): Promise<string[]> {
    return await this.web3.eth.getAccounts();
  }

  /**
   * Get token details such as name, symbol and decimals.
   *
   * If account is provided, returns also account balance for this token.
   *
   * @param account  Address to be queried for current token balance
   * @returns  Promise to [[MicroTokenInfo]] data
   */
  async getTokenInfo(account?: string): Promise<MicroTokenInfo> {

    const [name, symbol, decimals, balance] = await Promise.all([
      this.token.methods.name().call() as Promise<string>,
      this.token.methods.symbol().call() as Promise<string>,
      this.token.methods.decimals().call().then((d) => d.toNumber()) as Promise<number>,
      account ? (this.token.methods.balanceOf(account).call()) : null
    ]);
    this.decimals = decimals;
    return { name, symbol, decimals, balance };
  }

  /**
   * Get channel details such as current state (one of opened, closed or
   * settled), block in which it was set and current deposited amount
   *
   * @param channel  Channel to get info from. Default to [[channel]]
   * @returns Promise to [[MicroChannelInfo]] data
   */
  async getChannelInfo(channel?: MicroChannel): Promise<MicroChannelInfo> {
    if (!channel) {
      channel = this.channel;
    }
    if (!this.isChannelValid(channel)) {
      throw new Error('No valid channelInfo');
    }

    const closeEvents = await this.contract.getPastEvents('ChannelCloseRequested', {
      filter: {
        _sender_address: channel.account, _receiver_address: channel.receiver,
        _open_block_number: channel.block,
      },
      fromBlock: channel.block,
      toBlock: 'latest'
    })
    let closed: number;
    if (!closeEvents || closeEvents.length === 0) {
      closed = 0;
    } else {
      closed = closeEvents[0].blockNumber;
    }

    const settleEvents = await this.contract.getPastEvents('ChannelSettled', {
      filter: {
        _sender_address: channel.account, _receiver_address: channel.receiver,
        _open_block_number: channel.block,
      },
      fromBlock: closed || channel.block,
      toBlock: 'latest'
    })
    let settled: number;
    if (!settleEvents || settleEvents.length === 0) {
      settled = 0;
    } else {
      settled = settleEvents[0].blockNumber;
    }
    // for settled channel, getChannelInfo call will fail, so we return before
    if (settled) {
      return {
        state: 'settled',
        block: settled,
        deposit: new BigNumber(0),
        withdrawn: new BigNumber(0),
      };
    }

    const info = await this.contract.methods.getChannelInfo(
      channel.account,
      channel.receiver,
      channel.block
    ).call()
    if (!(info[1].gt(0))) {
      throw new Error('Invalid channel deposit: ' + JSON.stringify(info));
    }
    return {
      'state': closed ? 'closed' : 'opened',
      'block': closed || channel.block,
      'deposit': info[1],
      'withdrawn': info[4],
    };
  }

  /**
   * Open a channel for account to receiver, depositing some tokens on it
   *
   * Should work with both ERC20/ERC223 tokens.
   * Replaces current [[channel]] data
   *
   * @param account  Sender/client's account address
   * @param receiver  Receiver/server's account address
   * @param deposit  Tokens to be initially deposited in the channel
   * @returns  Promise to [[MicroChannel]] info object
   */
  async openChannel(account: string, receiver: string, deposit: BigNumber): Promise<MicroChannel> {
    if (this.isChannelValid()) {
      console.warn('Already valid channel will be forgotten:', this.channel);
    }

    // first, check if there's enough balance
    const balance = await this.token.methods.balanceOf(account).call();
    if (!(balance.gte(deposit))) {
      throw new Error(`Not enough tokens.
        Token balance = ${balance}, required = ${deposit}`);
    }
    console.log('Token balance', this.token.options.address, balance);
    // call transfer to make the deposit, automatic support for ERC20/223 token
    let transferTxHash: string;
    let cmTransfer = this.token.methods['transfer(address,uint256,bytes)']
    if (cmTransfer) {
      // ERC223
      // transfer tokens directly to the channel manager contract
      transferTxHash = await cmTransfer(
        this.contract.options.address,
        deposit,
        account + receiver.replace(/^0x/i, ''), // _data (3rd param) is sender (20B) + receiver (20B)
        { gas: 100e3 }
      ).send();
    } else {
      // ERC20
      // send 'approve' transaction to token contract
      await this.token.methods.approve(
        this.contract.options.address,
        deposit,
        { gas: 130e3 }
      ).send();
      // send 'createChannel' transaction to channel manager contract
      transferTxHash = await this.contract.methods.createChannel(
        receiver,
        deposit,
        { gas: 130e3 }
      ).send();
    }
    console.log('transferTxHash', transferTxHash);

    // wait for 'transfer' transaction to be mined
    const receipt = await this.waitTx(transferTxHash, 1);

    // call getChannelInfo to be sure channel was created
    const info = await this.contract.methods.getChannelInfo(
      account,
      receiver,
      receipt.blockNumber
    ).call();
    if (!(info[1].gt(0))) {
      throw new Error('No deposit found!');
    }
    this.setChannel({
      account,
      receiver,
      block: receipt.blockNumber,
      proof: { balance: new BigNumber(0) },
    });

    // return channel
    return this.channel;
  }

  /**
   * Top up current channel, by depositing some [more] tokens to it
   *
   * Should work with both ERC20/ERC223 tokens
   *
   * @param deposit  Tokens to be deposited in the channel
   * @returns  Promise to tx hash
   */
  async topUpChannel(deposit: BigNumber): Promise<string> {
    if (!this.isChannelValid()) {
      throw new Error('No valid channelInfo');
    }

    const account = this.channel.account;
    // first, check if there's enough balance
    const balance = await this.token.methods.balanceOf(account).call()
    if (!(balance.gte(deposit))) {
      throw new Error(`Not enough tokens.
        Token balance = ${balance}, required = ${deposit}`);
    }
    console.log('Token balance', this.token.options.address, balance);

    // automatically support both ERC20 and ERC223 tokens
    let transferTxHash: string;
    let cmTransfer = this.token.methods['transfer(address,uint256,bytes)']
    if (cmTransfer) {
      // ERC223, just send token.transfer transaction
      // transfer tokens directly to the channel manager contract
      transferTxHash = await cmTransfer(
        this.contract.options.address,
        deposit,
        // sender goes as 3rd param (20B), plus receiver (20B) and blocknumber (4B)
        this.channel.account +
        this.channel.receiver.replace(/^0x/i, '') +
        encodeHex(this.channel.block, 8),
        { from: account, gas: 70e3 }).send()
    } else {
      // ERC20, approve channel manager contract to handle our tokens, then topUp
      // send 'approve' transaction to token contract
      await this.token.methods.approve(
        this.contract.options.address,
        deposit,
        { from: account, gas: 100e3 }).send();
      // send 'topUp' transaction to channel manager contract
      transferTxHash = await this.contract.methods.topUp(
        this.channel.receiver,
        this.channel.block,
        deposit,
        { from: account, gas: 100e3 }).send();
    }
    console.log('transferTxHash', transferTxHash);

    // wait for 'transfer' transaction to be mined
    await this.waitTx(transferTxHash, 1);
    return transferTxHash;
  }

  /**
   * Close current channel
   *
   * Optional parameter is signed cooperative close from receiver, if available.
   * If cooperative close was successful, channel is already settled after this
   * method is resolved.
   * Else, it enters 'closed' state, and should be settled after settlement
   * period, configured in contract.
   *
   * @param closingSig  Cooperative-close signature from receiver
   * @returns  Promise to closing tx hash
   */
  async closeChannel(closingSig?: string): Promise<string> {
    if (!this.isChannelValid()) {
      throw new Error('No valid channelInfo');
    }
    const info = await this.getChannelInfo();
    if (info.state !== 'opened') {
      throw new Error('Tried closing already closed channel');
    }

    if (this.channel.closing_sig) {
      closingSig = this.channel.closing_sig;
    } else if (closingSig) {
      this.setChannel(Object.assign(
        {},
        this.channel,
        { closing_sig: closingSig },
      ));
    }
    console.log(`Closing channel. Cooperative = ${closingSig}`);

    let proof: MicroProof;
    if (closingSig && !this.channel.proof.sig) {
      proof = await this.signNewProof(this.channel.proof);
    } else {
      proof = this.channel.proof;
    }

    let cmFunc: Function
    let gas: Number
    if (closingSig) {
      cmFunc = this.contract.methods.cooperativeClose
      gas = 120e3
    } else {
      cmFunc = this.contract.methods.uncooperativeClose
      gas = 100e3
    }
    let txHash = await cmFunc(
      this.channel.receiver,
      this.channel.block,
      proof.balance,
      proof.sig,
      closingSig,
      { from: this.channel.account, gas: gas }).send()

    console.log('closeTxHash', txHash);
    await this.waitTx(txHash, 0);
    return txHash;
  }

  /**
   * If channel was not cooperatively closed, and after settlement period,
   * this function settles the channel, distributing the tokens to sender and
   * receiver.
   *
   * @returns  Promise to settlement tx hash
   */
  async settleChannel(): Promise<string> {
    if (!this.isChannelValid()) {
      throw new Error('No valid channelInfo');
    }
    const [info, currentBlock] = await Promise.all([
      this.getChannelInfo(),
      this.web3.eth.getBlockNumber()
    ]);
    if (info.state !== 'closed') {
      throw new Error(`Tried settling opened or settled channel: ${info.state}`);
    } else if (this.challenge && currentBlock < info.block + this.challenge) {
      throw new Error(`Tried settling inside challenge period: ${currentBlock} < ${info.block} + ${this.challenge}`);
    }
    const txHash = await this.contract.methods.settle(
      this.channel.receiver,
      this.channel.block,
      { from: this.channel.account, gas: 120e3 }).send()

    console.log('settleTxHash', txHash);
    await this.waitTx(txHash, 0);
    return txHash;
  }

  /**
   * Ask user for signing a string with (personal|eth)_sign
   *
   * @param msg  Data to be signed
   * @returns Promise to signature
   */
  async signMessage(msg: string): Promise<string> {
    if (!this.isChannelValid()) {
      throw new Error('No valid channelInfo');
    }
    const hex = msg.startsWith('0x') ? msg : ('0x' + encodeHex(msg));
    console.log(`Signing "${msg}" => ${hex}, account: ${this.channel.account}`);

    let sig: string;
    try {
      sig = await this.web3.eth.personal.sign(hex, this.channel.account, '') /* don't know how to specify password*/
    } catch (err) {
      if (err.message &&
        (err.message.includes('Method not found') ||
          err.message.includes('is not a function') ||
          err.message.includes('not supported'))) {
        sig = await this.web3.eth.sign(this.channel.account, hex)
      } else {
        throw err;
      }
    }
    return sig;
  }

  /**
   * Ask user for signing a channel balance
   *
   * Notice it's the final balance, not the increment, and that the new
   * balance is set in [[MicroChannel.next_proof]], requiring a
   * [[confirmPayment]] call to persist it, after successful
   * request.
   * Implementation can choose to call confirmPayment right after this call
   * resolves, assuming request will be successful after payment is signed.
   * Tries to use eth_signTypedData (from EIP712), tries to use personal sign
   * if it fails.
   *
   * @param proof  Balance proof to be signed
   * @returns  Promise to signature
   */
  async signNewProof(proof?: MicroProof): Promise<MicroProof> {
    if (!this.isChannelValid()) {
      throw new Error('No valid channelInfo');
    }
    console.log('signNewProof', proof);
    if (!proof) {
      proof = this.channel.proof;
    }
    if (proof.sig) {
      return proof;
    }

    const params = this.getBalanceProofSignatureParams(proof);
    let sig: string = ''
    try {
      /*
      const result = await promisify<{ result: string, error: Error }>(
        this.web3.currentProvider, 'sendAsync'
      )({
        method: 'eth_signTypedData',
        params: [params, this.channel.account],
        from: this.channel.account
      });
      if (result.error)
        throw result.error;
      sig = result.result;*/
      /* TODO: handle this in some other day. */
      this.web3.currentProvider.send(
        {
          jsonrpc: '2.0', id: 1,
          method: 'eth_signTypedData', params: [params, this.channel.account]
        },
        (err: Error, resp: W3T.JsonRPCResponse) => {
          sig = resp.result // todo: promise this
        }
      )
    } catch (err) {
      if (err.message && err.message.includes('User denied')) {
        throw err;
      }
      console.log('Error on signTypedData', err);
      const hash = typedSignatureHash(params);
      // ask for signing of the hash
      sig = await this.signMessage(hash);
    }
    // debug
    const recovered = recoverTypedSignature({ data: params, sig: sig });
    console.log('signTypedData =', sig, recovered);
    if (recovered !== this.channel.account) {
      throw new Error(`Invalid recovered signature: ${recovered} != ${this.channel.account}. Do your provider support eth_signTypedData?`);
    }

    proof.sig = sig;

    // return signed message
    if (proof.balance.eq(this.channel.proof.balance)) {
      this.setChannel(Object.assign(
        {},
        this.channel,
        { proof, next_proof: proof }
      ));
    } else {
      this.setChannel(Object.assign(
        {},
        this.channel,
        { next_proof: proof }
      ));
    }
    return proof;
  }

  /**
   * Ask user for signing a payment, which is previous balance incremented of
   * amount.
   *
   * Warnings from [[signNewProof]] applies
   *
   * @param amount  Amount to increment in current balance
   * @returns  Promise to signature
   */

  async incrementBalanceAndSign(amount: BigNumber): Promise<MicroProof> {
    if (!this.isChannelValid()) {
      throw new Error('No valid channelInfo');
    }
    const proof: MicroProof = { balance: this.channel.proof.balance.add(amount) };
    // get current deposit
    const info = await this.getChannelInfo();
    if (info.state !== 'opened') {
      throw new Error('Tried signing on closed channel');
    } else if (proof.balance.gt(info.deposit)) {
      var err = new FundError(`Insuficient funds: current = ${info.deposit} , required = ${proof.balance}`);
      err.current = info.deposit
      err.required = proof.balance
      throw err;
    }
    // get hash for new balance proof
    return await this.signNewProof(proof);
  }

  /**
   * Persists [[MicroChannel.next_proof]] to [[MicroChannel.proof]]
   *
   * This method must be used after successful payment request,
   * or right after [[signNewProof]] is resolved,
   * if implementation don't care for request status
   */
  confirmPayment(proof: MicroProof): void {
    if (!this.channel.next_proof
      || !this.channel.next_proof.sig
      || this.channel.next_proof.sig !== proof.sig) {
      throw new Error('Invalid provided or stored next signature');
    }
    const channel = Object.assign(
      {},
      this.channel,
      { proof: this.channel.next_proof },
    );
    delete channel.next_proof;
    this.setChannel(channel);
  }

  /**
   * Reset the current channel balance.
   *
   * Used mainly when server replies a balance out-of-sync with current state
   * Caution: it sets the balance without verifying it. If possible, prefer
   * [[verifyProof]]
   *
   * @param value  Balance value to be set
   */
  setBalance(value: BigNumber): void {
    if (this.channel.proof.balance.eq(value)) {
      return;
    }
    const channel = Object.assign(
      {},
      this.channel,
      { proof: { balance: value }, next_proof: undefined },
    );
    delete channel.next_proof;
    this.setChannel(channel);
  }

  /**
   * Verify and set given proof as current, if valid
   *
   * Used mainly when server replies with an updated balance proof.
   *
   * @param proof  Balance proof, containing balance and signatue
   * @returns  True if balance is valid and correct, false otherwise
   */
  verifyProof(proof: MicroProof): boolean {
    if (!proof.sig) {
      throw new Error('Proof must contain a signature and its respective balance');
    }
    const params = this.getBalanceProofSignatureParams(proof);
    const recovered = recoverTypedSignature({ data: params, sig: proof.sig });
    console.log('verify signTypedData =', params, proof.sig, recovered);

    // recovered data from proof must be equal current account
    if (recovered !== this.channel.account) {
      return false;
    }

    const channel = Object.assign(
      {},
      this.channel,
      { proof, next_proof: undefined },
    );
    delete channel.next_proof;
    this.setChannel(channel);
    return true;
  }

  /**
   * For testing. Send 0.1 ETH to mint method of contract.
   * On TKN tests, it'll issue 50 TKNs to the sender's account.
   *
   * @param account  Sender's account address
   * @returns Promise to mint tx receipt
   */

  async buyToken(account: string): Promise<W3T.TransactionReceipt> {
    const txHash = await this.token.methods.mint({
      from: account,
      value: this.web3.utils.toWei(0.1, 'ether')
    }).send();
    console.log('mintTxHash', txHash);
    return await this.waitTx(txHash, 1);
  }

  /**
   * Watch for a particular transaction hash to have given confirmations
   *
   * @param txHash  Transaction hash to wait for
   * @param confirmations  Number of confirmations to wait after tx is mined
   * @returns  Promise to mined receipt of transaction
   */
  private async waitTx(txHash: string, confirmations?: number): Promise<W3T.TransactionReceipt> {
    confirmations = confirmations || 0;
    const blockStart = await this.web3.eth.getBlockNumber();

    do {
      const [receipt, block] = await Promise.all([
        await this.web3.eth.getTransactionReceipt(txHash),
        await this.web3.eth.getBlockNumber(),
      ]);

      if (!receipt || !receipt.blockNumber) {
        console.log('Waiting tx..', block - blockStart);
      } else if (block - receipt.blockNumber < confirmations) {
        console.log('Waiting confirmations...', block - receipt.blockNumber);
      } else {
        return receipt;
      }
      await asyncSleep(2e3);
    } while (true);
  }

  private getBalanceProofSignatureParams(proof: MicroProof): TypedData[] {
    return [
      {
        type: 'string',
        name: 'message_id',
        value: 'Sender balance proof signature',
      },
      {
        type: 'address',
        name: 'receiver',
        value: this.channel.receiver,
      },
      {
        type: 'uint32',
        name: 'block_created',
        value: '' + this.channel.block,
      },
      {
        type: 'uint192',
        name: 'balance',
        value: proof.balance.toString(),
      },
      {
        type: 'address',
        name: 'contract',
        value: this.contract.options.address
      },
    ];
  }

}
