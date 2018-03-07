declare namespace ethsig {
    interface TypedData {
        name: string;
        type: string;
        value: any;
    }
    interface MsgParam {
        data: TypedData[];
        sig: string;
    }
    function concatSig(v: Buffer, r: Buffer, s: Buffer): string;
    function normalize(input: number | string): string;
    function personalSign(privateKey: Buffer, msgParams: MsgParam): string;
    function recoverPersonalSignature(msgParams: MsgParam): string;
    function extractPublicKey(msgParams: MsgParam): string;
    function typedSignatureHash(typedData: TypedData[]): string;
    function signTypedData(privateKey: Buffer, msgParams: MsgParam): string;
    function recoverTypedSignature(msgParams: MsgParam);
}

export = ethsig