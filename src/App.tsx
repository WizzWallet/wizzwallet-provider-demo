import { App as AntdApp, Button, ConfigProvider, Divider, Input, InputNumber, Segmented, Select, theme } from 'antd';
import Lottie from 'lottie-react';
import Logo from './assets/logo.json';
import 'antd/dist/reset.css';
import React, { useEffect, useMemo, useState } from 'react';
import { AtomicalWithUTXOs, IWalletProvider, SignMessageType, WalletAssetBalance } from '@wizz-btc/provider';
import { buildTx, NetworkType, toPsbt } from '@wizz-btc/wallet';
import ReactJson from 'react-json-view';
import { FaGithub } from 'react-icons/fa6';
import Split from './Split.tsx';


function App() {
  const [address, setAddress] = useState<string>();
  const [network, setNetwork] = useState<NetworkType>();
  const { message } = AntdApp.useApp();
  const [provider, setProvider] = useState<IWalletProvider>();
  const [publicKey, setPublicKey] = useState<string>();
  const [balance, setBalance] = useState<{
    confirmed: number,
    unconfirmed: number,
    total: number,
  }>();
  const [atomicals, setAtomicals] = useState<WalletAssetBalance>();
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    const bindEvents = (provider: IWalletProvider) => {
      provider.on('accountsChanged', (accounts: string[]) => {
        if (accounts.length) {
          setAddress(accounts[0]);
        } else {
          setAddress(undefined);
        }
      });
      provider.on('networkChanged', (network: NetworkType) => {
        setNetwork(network);
      });
      setProvider(provider);
    };
    if (window.wizz) {
      bindEvents(window.wizz);
    } else {
      const interval = setInterval(() => {
        if (window.wizz) {
          bindEvents(window.wizz);
          clearInterval(interval);
        }
      }, 1000);
      return () => {
        clearInterval(interval);
      };
    }
  }, []);
  useEffect(() => {
    provider?.getNetwork().then((network) => {
      setNetwork(network);
    });
  }, [provider]);
  useEffect(() => {
    provider?.getPublicKey().then((publicKey) => {
      setPublicKey(publicKey);
    });
  }, [provider, address]);
  useEffect(() => {
    if (provider?.getBalance) {
      provider?.getBalance().then((balance) => {
        setBalance(balance);
      });
    }
  }, [provider, address]);
  useEffect(() => {
    if (provider?.getVersion) {
      provider?.getVersion().then((version) => {
        setVersion(version);
      });
    }
  }, [provider]);
  useEffect(() => {
    if (provider?.getAssets) {
      provider?.getAssets().then((atomicals) => {
        setAtomicals(atomicals);
      }).catch((e) => {
        console.log(e);
      });
    }
  }, [provider, address]);
  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#ff9813',
        colorLink: '#ff9813',
      },
      algorithm: theme.darkAlgorithm,
    }}>
      <AntdApp
        className={'max-w-xl mx-auto px-4 mb-12 mt-4 flex flex-col gap-4 font-mono break-words break-all text-xs'}>
        <div className={'flex items-center justify-center relative'}>
          <Lottie animationData={Logo} loop={true} className={'w-40'} />
          <a href="https://github.com/WizzWallet/wizzwallet-provider-demo" target={'_blank'}
             className={'absolute top-0 right-0 leading-none text-3xl'}
             rel={'noreferrer'}><FaGithub /></a>
        </div>
        {
          address ? <>
            <div>Version: <span className={'text-secondary'}>{version}</span></div>
            <div>Address: <br /><span className={'text-secondary'}>{address}</span></div>
            <div>Public Key: <br /><span className={'text-secondary'}>{publicKey}</span></div>
            <div>Network: <br /><span className={'text-secondary'}>{network}</span></div>
            <Segmented block={true} options={['livenet', 'testnet']} value={network} onChange={(e) => {
              provider?.switchNetwork(e as NetworkType).then((v) => {
                console.log(v);
              });
            }} />
            {
              balance ?
                <div>Balance: <br /><span
                  className={'text-secondary'}>confirmed: {balance.confirmed.toLocaleString('en-US')} sats,
              unconfirmed: {balance.unconfirmed.toLocaleString('en-US')} sats,
              total: {balance.total.toLocaleString('en-US')} sats</span></div> : null
            }
            {
              atomicals ?
                <>
                  <div>Assets: <br /><span
                    className={'text-secondary'}>arc20: {atomicals.atomicalFTs.length},
              atomicals NFTs: {atomicals.atomicalNFTs.length},
              ordinals: {atomicals.ordinalsUTXOs.length}</span></div>
                  <ReactJson src={atomicals} theme="monokai" collapsed={true} name={'Assets'}
                             style={{ padding: '8px', borderRadius: '6px' }} />
                  <Divider dashed={true} className={'!my-0'} />
                  <SendBitcoin address={address} />
                  <Divider dashed={true} className={'!my-0'} />
                  <SendAtomicals address={address} nfts={atomicals.atomicalNFTs || []} />
                  <Divider dashed={true} className={'!my-0'} />
                  <SendARC20 address={address} fts={atomicals.atomicalFTs || []} />
                  <Divider dashed={true} className={'!my-0'} />
                  <SignPSBT address={address} balance={atomicals} publicKey={publicKey!} />
                  <Divider dashed={true} className={'!my-0'} />
                </> : null
            }
            <SignMessage />
            {
              address && publicKey ?
                <Split address={address} provider={provider!} publicKey={publicKey} /> : null
            }
            <Divider dashed={true} className={'!my-0'} />
            <Button className={'w-full text-red-500'} onClick={() => {
              setAddress(undefined);
            }}>Disconnect</Button>
          </> : <Button className={'w-full'} onClick={() => {
            if (provider) {
              provider.requestAccounts().then((accounts) => {
                if (accounts.length) {
                  setAddress(accounts[0]);
                }
              }).catch((e) => {
                message.error(e.message);
              });
            } else {
              message.error('No provider found, please install Wizz Wallet');
            }
          }}>Connect</Button>
        }
      </AntdApp>
    </ConfigProvider>
  );
}


function SignMessage() {
  const [msg, setMsg] = useState<string>('Hello World!');
  const [type, setType] = useState<SignMessageType>();
  const [result, setResult] = useState<React.ReactNode>();
  return <>
    <Input.TextArea placeholder={'message'} value={msg} onChange={(e) => setMsg(e.target.value)} allowClear />
    <Segmented block={true} options={['ecdsa', 'bip322-simple']} value={type} onChange={(e) => {
      setType(e as SignMessageType);
    }} />
    {
      !!result && <div>{result}</div>
    }
    <Button className={'w-full'} disabled={!msg} onClick={() => {
      window.wizz.signMessage(msg, type).then((e) => {
        setResult(e);
      }).catch((e) => {
        setResult(e.message || 'Unknown error');
      });
    }}>Sign Message</Button>
  </>;
}

function SignPSBT({ address, balance, publicKey }: {
  address: string;
  balance: WalletAssetBalance;
  publicKey: string;
}) {
  const [addr, setAddr] = useState<string>(address);
  useEffect(() => {
    setAddr(address);
  }, [address]);
  const [amount, setAmount] = useState<number>(1000);
  const [feeRate, setFeeRate] = useState<number>(10);
  const [result, setResult] = useState<React.ReactNode>();
  const { message } = AntdApp.useApp();
  return <>
    <Input placeholder={'receive address'} value={addr} onChange={(e) => setAddr(e.target.value)} allowClear />
    <div className={'flex items-center gap-2'}>
      <InputNumber className={'flex-1'} placeholder={'amount'} value={amount} min={546}
                   onChange={(e) => setAmount(e as any)} />
      <InputNumber className={'flex-1'} placeholder={'fee rate'} value={feeRate} min={1}
                   onChange={(e) => setFeeRate(e as any)} />
    </div>
    {
      !!result && <div>{result}</div>
    }
    <Button className={'w-full'} disabled={!amount || !addr} onClick={() => {
      const tx = buildTx({
        inputs: [],
        outputs: [{
          address: addr!,
          value: amount!,
        }],
        balances: balance.regularUTXOs,
        feeRate: feeRate,
        address: balance.address,
        amount: amount!,
      });
      if (tx.error) {
        setResult(tx.error);
        return message.error(tx.error);
      }
      const psbt = toPsbt({ tx: tx.ok!, pubkey: publicKey, rbf: true });
      window.wizz.signPsbt(psbt.toHex()).then((e) => {
        setResult(e);
      }).catch((e) => {
        setResult(e.message || 'Unknown error');
      });
    }}>Sign PSBT</Button>
  </>;
}

function SendAtomicals({ address, nfts }: { address: string; nfts: any[]; }) {
  const [addr, setAddr] = useState<string>(address);
  useEffect(() => {
    setAddr(address);
  }, [address]);
  const [atomicalIds, setAtomicalIds] = useState<string[]>([]);
  const [feeRate, setFeeRate] = useState<number>(10);
  const [result, setResult] = useState<React.ReactNode>();
  const options = useMemo(() => nfts.map((e) => ({
    label: '# ' + e.atomical_number.toLocaleString('en-US'),
    value: e.atomical_id,
  })), [nfts]);
  return <>
    <Select mode="multiple" placeholder={'Select atomicals'} options={options} value={atomicalIds}
            onChange={(e) => setAtomicalIds(e)} />
    <Input placeholder={'receive address'} value={addr} onChange={(e) => setAddr(e.target.value)} allowClear />
    <InputNumber className={'w-full'} placeholder={'fee rate'} value={feeRate} min={1}
                 onChange={(e) => setFeeRate(e as any)} />
    {
      !!result && <div>{result}</div>
    }
    <Button className={'w-full'} disabled={!addr || !atomicalIds?.length} onClick={() => {
      let options: { feeRate: number } | undefined;
      if (feeRate) {
        options = { feeRate };
      }
      window.wizz.sendAtomicals(addr!, atomicalIds!, options).then((e) => {
        setResult(e);
      }).catch((e) => {
        setResult(e.message || 'Unknown error');
      });
    }}>Send Atomicals</Button>
  </>;
}


function SendARC20({ address, fts }: { address: string; fts: AtomicalWithUTXOs[]; }) {
  const [addr, setAddr] = useState<string>(address);
  useEffect(() => {
    setAddr(address);
  }, [address]);
  const [ticker, setTicker] = useState<string>();
  const [feeRate, setFeeRate] = useState<number>(10);
  const [amount, setAmount] = useState<number>();
  const [result, setResult] = useState<React.ReactNode>();
  const options = useMemo(() => fts.map((e) => ({
    label: e.$request_ticker + ' - ' + e.value.toLocaleString('en-US'),
    value: e.$request_ticker,
  })), [fts]);
  return <>
    <Select placeholder={'Select an arc20'} options={options} value={ticker}
            onChange={(e) => setTicker(e)} />
    <Input placeholder={'receive address'} value={addr} onChange={(e) => setAddr(e.target.value)} allowClear />
    <div className={'flex gap-2'}>
      <InputNumber className={'flex-1'} placeholder={'amount'} value={amount} min={1}
                   onChange={(e) => setAmount(e as any)} />
      <InputNumber className={'flex-1'} placeholder={'fee rate'} value={feeRate} min={1}
                   onChange={(e) => setFeeRate(e as any)} />
    </div>
    {
      !!result && <div>{result}</div>
    }
    <Button className={'w-full'} disabled={!addr || !amount || !ticker} onClick={() => {
      let options: { feeRate: number } | undefined;
      if (feeRate) {
        options = { feeRate };
      }
      window.wizz.sendARC20(addr!, ticker!, amount!, options).then((e) => {
        setResult(e);
      }).catch((e) => {
        setResult(e.message || 'Unknown error');
      });
    }}>Send ARC20</Button>
  </>;
}

function SendBitcoin({ address }: { address: string; }) {
  const [addr, setAddr] = useState<string>(address);
  useEffect(() => {
    setAddr(address);
  }, [address]);
  const [amount, setAmount] = useState<number>(1000);
  const [feeRate, setFeeRate] = useState<number>(10);
  const [result, setResult] = useState<React.ReactNode>();
  return <>
    <Input placeholder={'receive address'} value={addr} onChange={(e) => setAddr(e.target.value)} allowClear />
    <div className={'flex items-center gap-2'}>
      <InputNumber className={'flex-1'} placeholder={'amount'} value={amount} min={546}
                   onChange={(e) => setAmount(e as any)} />
      <InputNumber className={'flex-1'} placeholder={'fee rate'} value={feeRate} min={1}
                   onChange={(e) => setFeeRate(e as any)} />
    </div>
    {
      !!result && <div>{result}</div>
    }
    <Button className={'w-full'} disabled={!amount || !addr} onClick={() => {
      let options: { feeRate: number } | undefined;
      if (feeRate) {
        options = { feeRate };
      }
      window.wizz.sendBitcoin(addr!, amount!, options).then((e) => {
        setResult(e);
      }).catch((e) => {
        setResult(e.message || 'Unknown error');
      });
    }}>Send Bitcoin</Button>
  </>;
}

export default App;
