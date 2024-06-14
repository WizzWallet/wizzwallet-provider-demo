# Wizz Wallet Provider Demo

## Getting Started

```shell
pnpm install && pnpm run dev
```

```typescript
// current connected account address info
const addressInfo = {
  output: ...,
  scripthash: ...,
  network: ...,
}

// query all atomicals balance
const balance = await fetch(`${electrumUrl}/blockchain.atomicals.listscripthash?params=["${addressInfo.scripthash}",true]`, { signal: controller.signal }).then((res) => {
  return res.json();
});

// pure utxos without any assets
const pureUTXOs = balance.utxos.filter((utxo: any) => {
  if (Array.isArray(utxo.atomicals)) {
    return utxo.atomicals.length == 0;
  }
  if (typeof utxo.atomicals === 'object') {
    return Object.keys(utxo.atomicals).length === 0;
  }
  // unreachable
  return false;
}).sort((a: any, b: any) => b.value - a.value);

const atomicals = balance.atomicals;
const utxos = balance.utxos;
const fs: Record<string, any> = {};
for (const utxo of utxos) {
  // compatible with old format
  if (Array.isArray(utxo.atomicals)) {
    // ignore merged assets
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
  }
  // new format
  else if (typeof utxo.atomicals === 'object') {
    // ignore merged assets
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
const allFTs = Object.values(fs);

// pick a FT from allFTs
const ftUTXOs = selectedFT.utxos;
// send ft amount
const amount = 1;
// input ft value
let inputFTValue = 0;
// remainder ft value
let remainderFTValue = 0;
// input ft utxos
const revealInputs = [];
for (const utxo of ftUTXOs) {
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
    // send to any address
    address: toAddress,
    // ft value less than the dust amount(546) will be partially colored.
    value: Math.max(amount, 546),
  },
];
payload[selectedFT.atomical_id] = {
  0: amount,
};
if (remainderFTValue) {
  revealOutputs.push({
    address: address,
    // ft value less than the dust amount(546) will be partially colored.
    value: Math.max(remainderFTValue, 546),
  });
  payload[selectedFT.atomical_id][1] = remainderFTValue;
}

// prepare commit reveal config
const buffer = new AtomicalsPayload(payload).cbor();
// user's public key to xpub
const selfXOnly = toXOnly(Buffer.from(publicKey, 'hex'));
// use `z` op type
const { scriptP2TR, hashLockP2TR } = prepareCommitRevealConfig('z', selfXOnly, buffer, addressInfo.network);
const hashLockP2TROutputLen = hashLockP2TR.redeem!.output!.length;
// calculate fee
const revealFee = calculateAmountRequiredForReveal(feeRate, revealInputs.length, revealOutputs.length, hashLockP2TROutputLen);
// calculate need for reveal transaction
const revealNeed = revealFee + revealOutputs.reduce((acc, output) => acc + output.value, 0) - revealInputs.reduce((acc, input) => acc + input.value, 0);


// prepare commit transaction
// reveal transaction output
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
// calculate utxo inputs and fee
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
  throw new Error('Insufficient funds');
}

// create commit psbt
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

// get the transaction txid for reveal input utxo hash
const tx = commitPsbt.__CACHE.__TX as Transaction;
const txId = tx.getId();


// create reveal psbt
const revealPsbt = new bitcoin.Psbt({ network: addressInfo.network });
// build tap leaf script
const tapLeafScript = {
  leafVersion: hashLockP2TR!.redeem!.redeemVersion,
  script: hashLockP2TR!.redeem!.output,
  controlBlock: hashLockP2TR.witness![hashLockP2TR.witness!.length - 1],
};

revealPsbt.addInput({
  sequence: 0xfffffffd,
  // commit transaction txid
  hash: txId,
  index: 0,
  witnessUtxo: { value: revealNeed, script: hashLockP2TR.output! },
  tapLeafScript: [tapLeafScript as any],
});

// add reveal inputs
for (const revealInput of revealInputs) {
  // 
  revealPsbt.addInput({
    sequence: 0xfffffffd,
    hash: revealInput.txid,
    index: revealInput.index,
    witnessUtxo: { value: revealInput.value, script: addressInfo.output },
    tapInternalKey: selfXOnly,
  });
}
revealPsbt.addOutputs(revealOutputs);

// sign commit psbt
const signedCommitPsbt = await window.wizz.signPsbt(commitPsbt.toHex());
// sign reveal psbt with `signAtomical` option
const signedRevealPsbt = await window.wizz.signPsbt(revealPsbt.toHex(), { signAtomical: true });

// broadcast commit transaction
const commitTxId = await window.wizz.pushPsbt(signedCommitPsbt);
// broadcast reveal transaction
const revealTxId = await window.wizz.pushPsbt(signedRevealPsbt);
```
```json
{
  "atom_id": {
    "1": 300,
    "2": 600
  }
}
```

```typescript
import { ECPairInterface } from 'ecpair';

function signRevealPsbt(keyFor: ECPairInterface, psbtHex: string, network: Network) {
  const psbt = Psbt.fromHex(psbtHex, { network });
  const childNodeXOnlyPubkey = toXOnly(keyFor.publicKey);
  const tapLeafScript = psbt.data.inputs[0].tapLeafScript![0] as TapLeafScript;
  const customFinalizer = (_inputIndex: number, input: any) => {
    const witness = [input.tapScriptSig[0].signature, tapLeafScript.script, tapLeafScript.controlBlock];
    return {
      finalScriptWitness: witnessStackToScriptWitness(witness),
    };
  };
  psbt.signInput(0, keyFor);
  psbt.finalizeInput(0, customFinalizer);
  const tweakedChildNode = keyFor.tweak(bitcoin.crypto.taggedHash('TapTweak', childNodeXOnlyPubkey));
  for (let i = 1; i < psbt.data.inputs.length; i++) {
    psbt.signInput(i, tweakedChildNode);
    psbt.finalizeInput(i);
  }
  return psbt.toHex();
}
```

