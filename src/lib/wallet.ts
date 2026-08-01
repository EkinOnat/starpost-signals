import {
  Networks as WalletNetworks,
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { LobstrModule } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { NETWORK_PASSPHRASE } from "../config";

export const walletChoices = [
  { name: "Freighter", note: "Browser extension" },
  { name: "xBull", note: "Extension + mobile" },
  { name: "Albedo", note: "Web wallet" },
  { name: "Lobstr", note: "Extension + mobile" },
];

StellarWalletsKit.init({
  modules: [
    new FreighterModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
  ],
  network: WalletNetworks.TESTNET,
  authModal: {
    hideUnsupportedWallets: false,
    showInstallLabel: true,
  },
});

export async function connectWallet() {
  const { address } = await StellarWalletsKit.authModal();
  const network = await StellarWalletsKit.getNetwork();

  if (network.networkPassphrase !== NETWORK_PASSPHRASE) {
    await StellarWalletsKit.disconnect();
    throw new Error("WRONG_NETWORK");
  }

  return {
    address,
    walletName: StellarWalletsKit.selectedModule.productName,
  };
}

export async function disconnectWallet() {
  await StellarWalletsKit.disconnect();
}

export async function signTransaction(xdr: string, address: string) {
  return StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
}
