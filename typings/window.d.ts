import { IWalletProvider } from '@wizz-btc/provider';

declare global {
  interface Window {
    wizz: IWalletProvider;
  }
}

export {};
