import { useEffect, useMemo, useReducer, useState } from 'react';
import { IWalletProvider } from '@wizz-btc/provider';
import { Alert, Button, Divider, Input, InputNumber, Select } from 'antd';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { Network, Payment, payments, script, Transaction } from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import * as cbor from 'borc';

bitcoin.initEccLib(ecc);

interface SplitProps {
  address: string;
  provider: IWalletProvider;
  publicKey: string;
}

export default function Split({ address, provider, publicKey }: SplitProps) {
  const addressInfo = useMemo(() => {
    return getAddressInfo(address);
  }, [address]);
  const [balance, setBalance] = useState<any>();
  const electrumUrl = useMemo(() => {
    if (addressInfo.network == bitcoin.networks.bitcoin) {
      return 'https://ep.wizz.cash/proxy';
    }
    return 'https://eptest.wizz.cash/proxy';
  }, [addressInfo.network]);
  const mempoolUrl = useMemo(() => {
    if (addressInfo.network == bitcoin.networks.bitcoin) {
      return 'https://mempool.space';
    }
    return 'https://mempool.space/testnet';
  }, [addressInfo.network]);

  const [x, forceUpdate] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${electrumUrl}/blockchain.atomicals.listscripthash?params=["${addressInfo.scripthash}",true]`, { signal: controller.signal }).then((res) => {
      return res.json();
    }).then((res) => {
      console.log(res);
      setBalance(res.response);
    });
    return () => {
      controller.abort();
    };
  }, [addressInfo.scripthash, electrumUrl, x]);


  const pureUTXOs = useMemo(() => {
    if (Array.isArray(balance?.utxos)) {
      return balance.utxos.filter((utxo: any) => {
        if (Array.isArray(utxo.atomicals)) {
          return utxo.atomicals.length == 0;
        }
        if (typeof utxo.atomicals === 'object') {
          return Object.keys(utxo.atomicals).length === 0;
        }
        // unreachable
        return false;
      }).sort((a: any, b: any) => b.value - a.value);
    }
    return [];
  }, [balance?.utxos]);

  const fts = useMemo(() => {
    if (balance) {
      const atomicals = balance.atomicals;
      const utxos = balance.utxos;
      const fs: Record<string, any> = {};
      for (const utxo of utxos) {
        if (Array.isArray(utxo.atomicals)) {
          if (utxo.atomicals.length !== 1) {
            continue;
          }
          const atomicalId = utxo.atomicals[0];
          const atomical = atomicals[atomicalId].data;
          if (atomical.type !== 'FT') {
            continue;
          }
          utxo.atomical_value = utxo.value;
          if (atomical.utxos) {
            atomical.utxos.push(utxo);
            atomical.atomical_value += utxo.value;
          } else {
            atomical.utxos = [utxo];
            atomical.atomical_value = utxo.value;
          }
          fs[atomicalId] = atomical;
        } else if (typeof utxo.atomicals === 'object') {
          if (Object.keys(utxo.atomicals).length !== 1) {
            continue;
          }
          for (const atomicalId in utxo.atomicals) {
            const atomical = atomicals[atomicalId].data;
            if (atomical.type !== 'FT') {
              continue;
            }
            utxo.atomical_value = utxo.atomicals[atomicalId];
            if (atomical.utxos) {
              atomical.utxos.push(utxo);
              atomical.atomical_value += utxo.atomical_value;
            } else {
              atomical.utxos = [utxo];
              atomical.atomical_value = utxo.atomical_value;
            }
            fs[atomicalId] = atomical;
          }
        }
      }
      return Object.values(fs);
    }
    return [];
  }, [balance]);
  const [selectedFTId, setSelectedFTId] = useState<string>();
  useEffect(() => {
    if (selectedFTId) {
      const find = fts.find((ft) => ft.atomical_id === selectedFTId);
      if (!find) {
        setSelectedFTId(undefined);
      }
    }
  }, [fts, selectedFTId]);
  const options = useMemo(() => fts.map((ft) => ({
    key: ft.atomical_id,
    label: <div className={'flex items-center'}>
      <span className={'flex-1'}>{ft.$request_ticker}</span>
      <span>{ft.atomical_value.toLocaleString('en-US')}</span>
    </div>, value: ft.atomical_id,
  })), [fts]);
  const [amount, setAmount] = useState<number>();
  const [feeRate, setFeeRate] = useState<number>();
  const [toAddress, setToAddress] = useState<string>();
  const selectedFT = useMemo(() => {
    return fts.find((ft) => ft.atomical_id === selectedFTId);
  }, [fts, selectedFTId]);
  const [errMsg, setErrMsg] = useState<string>();
  const [result, setResult] = useState<any>();
  const [txids, setTxids] = useState<{ commitTxId: string; revealTxId: string }>();

  useEffect(() => {
    setErrMsg(undefined);
    setResult(undefined);
    if (!selectedFT || !amount || !feeRate || !toAddress) {
      return;
    }
    if (amount > selectedFT.atomical_value) {
      // unreachable
      setErrMsg('Amount exceeds the balance of the selected FT.');
      return;
    }
    try {
      getAddressInfo(toAddress);
    } catch (e) {
      console.log(e);
      setErrMsg('Invalid address.');
      return;
    }
    const fts = selectedFT.utxos;
    let inputFTValue = 0;
    let remainderFTValue = 0;
    const revealInputs = [];
    for (const utxo of fts) {
      inputFTValue += utxo.atomical_value;
      revealInputs.push(utxo);
      remainderFTValue = inputFTValue - amount;
      if (remainderFTValue >= 0) {
        break;
      }
    }
    const payload: Record<string, Record<number, number>> = {};

    const revealOutputs = [
      {
        address: toAddress,
        value: Math.max(amount, 546),
      },
    ];
    payload[selectedFT.atomical_id] = {
      0: amount,
    };
    if (remainderFTValue) {
      revealOutputs.push({
        address: address,
        value: Math.max(remainderFTValue, 546),
      });
      payload[selectedFT.atomical_id][1] = remainderFTValue;
    }
    const buffer = new AtomicalsPayload(payload).cbor();
    const toXOnly = (pubKey: Buffer) => pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);
    const selfXOnly = toXOnly(Buffer.from(publicKey, 'hex'));
    const { scriptP2TR, hashLockP2TR } = prepareCommitRevealConfig('z', selfXOnly, buffer, addressInfo.network);
    const hashLockP2TROutputLen = hashLockP2TR.redeem!.output!.length;
    const revealFee = calculateAmountRequiredForReveal(feeRate, revealInputs.length, revealOutputs.length, hashLockP2TROutputLen);
    const revealNeed = revealFee + revealOutputs.reduce((acc, output) => acc + output.value, 0) - revealInputs.reduce((acc, input) => acc + input.value, 0);

    const outputs = [
      {
        address: scriptP2TR.address!,
        value: revealNeed,
      },
    ];
    const inputs = [];
    let inputSats = 0;
    let ok = false;
    let fee = 0;
    for (const utxo of pureUTXOs) {
      inputSats += utxo.value;
      inputs.push(utxo);
      fee = calculateFeesRequiredForCommit(feeRate, inputs.length, 1);
      let v = inputSats - fee - revealNeed;
      if (v >= 0) {
        if (v >= 546) {
          fee = calculateFeesRequiredForCommit(feeRate, inputs.length, 2);
          v = inputSats - fee - revealNeed;
          if (v >= 546) {
            outputs.push({
              address,
              value: v,
            });
          }
        }
        ok = true;
        break;
      }
    }
    if (!ok) {
      setErrMsg('Insufficient funds');
      return;
    }

    const commitPsbt = new bitcoin.Psbt({ network: addressInfo.network });
    for (const input of inputs) {
      commitPsbt.addInput({
        hash: input.txid,
        index: input.index,
        sequence: 0xfffffffd,
        witnessUtxo: {
          script: addressInfo.output,
          value: input.value,
        },
        tapInternalKey: selfXOnly,
      });
    }
    commitPsbt.addOutputs(outputs);

    const tx = commitPsbt.__CACHE.__TX as Transaction;
    const txId = tx.getId();

    const revealPsbt = new bitcoin.Psbt({ network: addressInfo.network });
    const tapLeafScript = {
      leafVersion: hashLockP2TR!.redeem!.redeemVersion,
      script: hashLockP2TR!.redeem!.output,
      controlBlock: hashLockP2TR.witness![hashLockP2TR.witness!.length - 1],
    };

    revealPsbt.addInput({
      sequence: 0xfffffffd,
      hash: txId,
      index: 0,
      witnessUtxo: { value: revealNeed, script: hashLockP2TR.output! },
      tapLeafScript: [tapLeafScript as any],
    });

    for (const revealInput of revealInputs) {
      revealPsbt.addInput({
        sequence: 0xfffffffd,
        hash: revealInput.txid,
        index: revealInput.index,
        witnessUtxo: { value: revealInput.value, script: addressInfo.output },
        tapInternalKey: selfXOnly,
      });
    }
    revealPsbt.addOutputs(revealOutputs);
    setResult({
      commitPsbt,
      revealPsbt,
      commitFee: commitPsbt.data.inputs.reduce((a, b) => a + b.witnessUtxo!.value, 0) - tx.outs.reduce((a, b) => a + b.value, 0),
      revealFee,
    });
  }, [address, addressInfo.network, addressInfo.output, amount, feeRate, publicKey, pureUTXOs, selectedFT, toAddress]);
  const isP2TR = addressInfo.addressType === AddressType.P2TR;
  return <>
    <div className={'text-soft-white text-xs'}>
      Splitting FT
    </div>
    {
      !isP2TR ?
        <Alert banner={true} className={'rounded'}
               message={'The demo currently only supports P2TR addresses.'} /> : null
    }
    <Select
      allowClear={true} options={options} onChange={(v) => {
      setSelectedFTId(v);
    }} />
    <div className={'flex items-center gap-2'}>
      <InputNumber
        placeholder={`Min: 1${selectedFT?.atomical_value ? ', Max: ' + selectedFT?.atomical_value : ''}`}
        className={'flex-[3]'} value={amount} min={1} max={selectedFT?.atomical_value} precision={0}
        addonAfter={selectedFT?.$request_ticker} onChange={(e) => {
        setAmount(e);
      }} />
      <InputNumber
        placeholder={'Fee Rate'}
        className={'flex-[2]'} value={feeRate}
        addonAfter={'sat/vB'} onChange={(e) => {
        setFeeRate(e);
      }} />
    </div>
    <Input value={toAddress} allowClear placeholder={'Address'} onChange={(e) => setToAddress(e.target.value)} />
    {
      errMsg ?
        <Alert banner={true} className={'rounded'} type={'error'} message={errMsg} /> : null
    }
    {result ?
      <div>Commit Fee: {result.commitFee.toLocaleString('en-US')} sats, Reveal
        Fee: {result.revealFee.toLocaleString('en-US')} sats</div> : null
    }
    {txids ?
      <div>Commit TxId: <a href={mempoolUrl + '/tx/' + txids.commitTxId} target={'_blank'}
                           rel={'noreferrer'}>{txids.commitTxId}</a>, Reveal TxId: <a
        href={mempoolUrl + '/tx/' + txids.revealTxId} rel={'noreferrer'} target={'_blank'}>{txids.revealTxId}</a>
      </div> : null
    }
    <Button block={true} disabled={!isP2TR || !result} onClick={() => {
      provider.signPsbt(result.commitPsbt.toHex()).then(async (commitPsbt) => {
        const revealPsbt = await provider.signPsbt(result.revealPsbt.toHex(), { signAtomical: true });
        return [commitPsbt, revealPsbt];
      }).then(async ([commitPsbt, revealPsbt]) => {
        const commitTxId = await provider.pushPsbt(commitPsbt);
        const revealTxId = await provider.pushPsbt(revealPsbt);
        const txids = { commitTxId, revealTxId };
        console.log(txids);
        setTxids(txids);
        forceUpdate();
      });
    }}>Send</Button>
    <Divider />
  </>;
}


function addressToP2PKH(address: string): string {
  const addressDecoded = bs58check.decode(address);
  const addressDecodedSub = Buffer.from(addressDecoded).toString('hex').substr(2);
  return `76a914${addressDecodedSub}88ac`;
}

function getAddressType(address: string): [AddressType, Network] {
  if (address.startsWith('bc1q')) {
    return [AddressType.P2WPKH, bitcoin.networks.bitcoin];
  } else if (address.startsWith('bc1p')) {
    return [AddressType.P2TR, bitcoin.networks.bitcoin];
  } else if (address.startsWith('1')) {
    return [AddressType.P2PKH, bitcoin.networks.bitcoin];
  } else if (address.startsWith('3')) {
    return [AddressType.P2SH_P2WPKH, bitcoin.networks.bitcoin];
  }
  // testnet
  else if (address.startsWith('tb1q')) {
    return [AddressType.P2WPKH, bitcoin.networks.testnet];
  } else if (address.startsWith('m') || address.startsWith('n')) {
    return [AddressType.P2PKH, bitcoin.networks.testnet];
  } else if (address.startsWith('2')) {
    return [AddressType.P2SH_P2WPKH, bitcoin.networks.testnet];
  } else if (address.startsWith('tb1p')) {
    return [AddressType.P2TR, bitcoin.networks.testnet];
  }
  throw new Error(`Unknown address: ${address}`);
}

function getAddressInfo(address: string) {
  const [addressType, network] = getAddressType(address);
  if (addressType === AddressType.P2PKH) {
    const p2pkh = addressToP2PKH(address);
    const output = Buffer.from(p2pkh, 'hex');
    return {
      output,
      scripthash: bitcoin.crypto.sha256(output).reverse().toString('hex'),
      addressType,
      network,
    };
  } else {
    const output = bitcoin.address.toOutputScript(address, network);
    return {
      output,
      scripthash: bitcoin.crypto.sha256(output).reverse().toString('hex'),
      addressType,
      network,
    };
  }
}

enum AddressType {
  P2PKH,
  P2WPKH,
  P2TR,
  P2SH_P2WPKH,
}


const FEE_BASE_BYTES = 10.5;
const FEE_INPUT_BYTES_BASE = 57.5;
const FEE_OUTPUT_BYTES_BASE = 43;

function calculateAmountRequiredForReveal(
  feeRate: number,
  inputNum: number,
  outputNum: number,
  hashLockP2TROutputLen = 0,
): number {
  // <Previous txid> <Output index> <Length of scriptSig> <Sequence number>
  // 32 + 4 + 1 + 4 = 41
  // <Witness stack item length> <Signature> ... <Control block>
  // (1 + 65 + 34) / 4 = 25
  // Total: 41 + 25 = 66
  const REVEAL_INPUT_BYTES_BASE = 66;
  let hashLockCompactSizeBytes = 9;
  if (hashLockP2TROutputLen <= 252) {
    hashLockCompactSizeBytes = 1;
  } else if (hashLockP2TROutputLen <= 0xffff) {
    hashLockCompactSizeBytes = 3;
  } else if (hashLockP2TROutputLen <= 0xffffffff) {
    hashLockCompactSizeBytes = 5;
  }
  return Math.ceil(
    feeRate *
    (FEE_BASE_BYTES +
      // Reveal input
      REVEAL_INPUT_BYTES_BASE +
      (hashLockCompactSizeBytes + hashLockP2TROutputLen) / 4 +
      // Additional inputs
      inputNum * FEE_INPUT_BYTES_BASE +
      // Outputs
      outputNum * FEE_OUTPUT_BYTES_BASE),
  );
}

function calculateFeesRequiredForCommit(
  feeRate: number,
  inputNum: number,
  outputNum: number,
): number {
  return Math.ceil(
    feeRate *
    (FEE_BASE_BYTES + inputNum * FEE_INPUT_BYTES_BASE + outputNum * FEE_OUTPUT_BYTES_BASE),
  );
}


type OpType = 'nft' | 'ft' | 'dft' | 'dmt' | 'dat' | 'mod' | 'evt' | 'sl' | 'x' | 'y' | 'z';

const prepareCommitRevealConfig = (
  opType: OpType,
  childNodeXOnlyPubkey: Buffer,
  atomicalsPayload: Buffer,
  network: Network,
): { hashscript: Buffer; scriptP2TR: Payment; hashLockP2TR: Payment } => {
  const revealScript = appendMintUpdateRevealScript(opType, childNodeXOnlyPubkey, atomicalsPayload);
  const hashscript = script.fromASM(revealScript);
  const scriptTree = {
    output: hashscript,
  };
  const hash_lock_script = hashscript;
  const hashLockRedeem = {
    output: hash_lock_script,
    redeemVersion: 192,
  };
  const scriptP2TR = payments.p2tr({
    internalPubkey: childNodeXOnlyPubkey,
    scriptTree,
    network,
  });

  const hashLockP2TR = payments.p2tr({
    internalPubkey: childNodeXOnlyPubkey,
    scriptTree,
    redeem: hashLockRedeem,
    network,
  });
  return {
    scriptP2TR,
    hashLockP2TR,
    hashscript,
  };
};

function chunkBuffer(buffer: Buffer, chunkSize: number) {
  assert(!isNaN(chunkSize) && chunkSize > 0, 'Chunk size should be positive number');
  const result: Buffer[] = [];
  const len = buffer.byteLength;
  let i = 0;
  while (i < len) {
    result.push(buffer.subarray(i, (i += chunkSize)));
  }
  return result;
}

function assert(cond: boolean, err: any) {
  if (!cond) {
    throw new Error(err);
  }
}


const ATOMICALS_PROTOCOL_ENVELOPE_ID = 'atom';

const appendMintUpdateRevealScript = (opType: OpType, childNodeXOnlyPubkey: Buffer, payload: Buffer) => {
  let ops = `${childNodeXOnlyPubkey.toString('hex')} OP_CHECKSIG OP_0 OP_IF `;
  ops += `${Buffer.from(ATOMICALS_PROTOCOL_ENVELOPE_ID, 'utf8').toString('hex')}`;
  ops += ` ${Buffer.from(opType, 'utf8').toString('hex')}`;
  const chunks = chunkBuffer(payload, 520);
  for (const chunk of chunks) {
    ops += ` ${chunk.toString('hex')}`;
  }
  ops += ' OP_ENDIF';
  return ops;
};

export class AtomicalsPayload {
  private cborEncoded;

  constructor(private originalData: any) {
    if (!originalData) {
      this.originalData = {};
      return;
    }

    function deepEqual(x: any, y: any): boolean {
      const ok = Object.keys,
        tx = typeof x,
        ty = typeof y;
      return x && y && tx === 'object' && tx === ty
        ? ok(x).length === ok(y).length && ok(x).every((key) => deepEqual(x[key], y[key]))
        : x === y;
    }

    function isAllowedtype(tc: any, allowBuffer = true): boolean {
      if (
        tc === 'object' ||
        tc === 'Number' ||
        tc === 'number' ||
        tc === 'null' ||
        tc === 'string' ||
        tc == 'boolean'
      ) {
        return true;
      }
      if (allowBuffer && tc === 'buffer') {
        return true;
      }
      return false;
    }

    function validateWhitelistedDatatypes(x: any, allowBuffer = true): boolean {
      const ok = Object.keys;
      const tx = typeof x;
      const isAllowed = isAllowedtype(tx, allowBuffer);
      if (!isAllowed) {
        console.log(tx, allowBuffer);
        return false;
      }
      if (tx === 'object') {
        return ok(x).every((key) => validateWhitelistedDatatypes(x[key], allowBuffer));
      }
      return true;
    }

    if (!validateWhitelistedDatatypes(originalData)) {
      throw new Error('Invalid payload contains disallowed data types. Use only number, string, null, or buffer');
    }

    // Also make sure that if either args, ctx, init, or meta are provided, then we never allow buffer.
    if (originalData['args']) {
      if (!validateWhitelistedDatatypes(originalData['args'], false)) {
        throw 'args field invalid due to presence of buffer type';
      }
    }
    if (originalData['ctx']) {
      if (!validateWhitelistedDatatypes(originalData['ctx'], false)) {
        throw 'ctx field invalid due to presence of buffer type';
      }
    }
    if (originalData['meta']) {
      if (!validateWhitelistedDatatypes(originalData['meta'], false)) {
        throw 'meta field invalid due to presence of buffer type';
      }
    }

    const payload = {
      ...originalData,
    };
    const cborEncoded = cbor.encode(payload);
    // Decode to do sanity check
    const cborDecoded = cbor.decode(cborEncoded);
    if (!deepEqual(cborDecoded, payload)) {
      throw 'CBOR Decode error objects are not the same. Developer error';
    }
    if (!deepEqual(originalData, payload)) {
      throw 'CBOR Payload Decode error objects are not the same. Developer error';
    }
    this.cborEncoded = cborEncoded;
  }

  get(): any {
    return this.originalData;
  }

  cbor(): any {
    return this.cborEncoded;
  }
}
