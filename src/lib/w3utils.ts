import Web3 from 'web3'
import * as W3T from 'web3/types'
import BN from 'bn.js'
import { typedSignatureHash, recoverTypedSignature, TypedData } from 'eth-sig-util'

function encodeHex(val: string | number | BN, zPadLength?: number): string {
    /* Encode a string or number as hexadecimal, without '0x' prefix */
    if (typeof val === 'number' || val instanceof BN) {
        val = val.toString(16);
    } else {
        val = Array.from(val as string).map((char: string) =>
            char.charCodeAt(0).toString(16).padStart(2, '0')
        ).join('');
    }
    return val.padStart(zPadLength || 0, '0');
}

interface MicroProof {
    balance: BN
    sig?: string
}

class SignModule {

    web3: Web3
    account: string
    constructor(web3: Web3) {
        this.web3 = web3
        this.account = web3.eth.defaultAccount
    }

    async signMessage(msg: string): Promise<string> {
        const hex = msg.startsWith('0x') ? msg : ('0x' + encodeHex(msg));
        let sig: string;
        try {
            sig = await this.web3.eth.personal.sign(hex, this.account, 'is_this_password?') /* don't know how to specify password*/
        } catch (err) {
            if (err.message &&
                (err.message.includes('Method not found') ||
                    err.message.includes('is not a function') ||
                    err.message.includes('not supported'))) {
                sig = await this.web3.eth.sign(this.account, hex)
            } else {
                throw err;
            }
        }
        return sig;
    }

    async signData(proof: MicroProof): Promise<string> {
        const params = this.getBalanceProofSignatureParams(proof)
        let sigprom: Promise<string>
        try {
            let sigpromise = new Promise<string>((resolve, reject) => {
                this.web3.currentProvider.send(
                    {
                        jsonrpc: '2.0', id: 1,
                        method: 'eth_signTypedData', params: [params, this.account]
                    },
                    (err: Error, resp: W3T.JsonRPCResponse) => {
                        if (err) {
                            reject(err.message)
                        } else {
                            resolve(resp.result)
                        }
                    }
                )
            })
            sigprom = sigpromise
        } catch (err) {
            if (err.message && err.message.includes('User denied')) {
                throw err;
            }
            console.log('Error on signTypedData', err)
            const hash = typedSignatureHash(params)
            // ask for signing of the hash
            sigprom = this.signMessage(hash)
        }
        /*
        const recovered = recoverTypedSignature({ data: params, sig: sig });
        console.log('signTypedData =', sig, recovered);*/
        return sigprom
    }
    private getBalanceProofSignatureParams(proof: MicroProof): TypedData[] {
        return [
            {
                type: 'string',
                name: 'Prompt',
                value: 'Make payment in this chain'
            },
            {
                type: 'string',
                name: 'receiver',
                value: 'Alice'
            },
            {
                type: 'uint192',
                name: 'value',
                value: proof.balance.toString(),
            }
        ]
    }
}

export { SignModule, MicroProof }