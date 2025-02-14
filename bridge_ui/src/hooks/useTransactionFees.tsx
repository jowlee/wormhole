import {
  ChainId,
  CHAIN_ID_ETH,
  CHAIN_ID_SOLANA,
  CHAIN_ID_TERRA,
} from "@certusone/wormhole-sdk";
import { Provider } from "@certusone/wormhole-sdk/node_modules/@ethersproject/abstract-provider";
import { formatUnits } from "@ethersproject/units";
import { Typography } from "@material-ui/core";
import { LocalGasStation } from "@material-ui/icons";
import { Connection, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEthereumProvider } from "../contexts/EthereumProviderContext";
import { getDefaultNativeCurrencySymbol, SOLANA_HOST } from "../utils/consts";
import { getMultipleAccountsRPC } from "../utils/solana";
import useIsWalletReady from "./useIsWalletReady";

export type GasEstimate = {
  currentGasPrice: string;
  lowEstimate: string;
  highEstimate: string;
};

export type MethodType = "nft" | "createWrapped" | "transfer";

//It's difficult to project how many fees the user will accrue during the
//workflow, as a variable number of transactions can be sent, and different
//execution paths can be hit in the smart contracts, altering gas used.
//As such, for the moment it is best to just check for a reasonable 'low balance' threshold.
//Still it would be good to calculate a reasonable value at runtime based off current gas prices,
//rather than a hardcoded value.
const SOLANA_THRESHOLD_LAMPORTS: bigint = BigInt(300000);
const ETHEREUM_THRESHOLD_WEI: bigint = BigInt(35000000000000000);

const isSufficientBalance = (chainId: ChainId, balance: bigint | undefined) => {
  if (balance === undefined || !chainId) {
    return true;
  }
  if (CHAIN_ID_SOLANA === chainId) {
    return balance > SOLANA_THRESHOLD_LAMPORTS;
  }
  if (CHAIN_ID_ETH === chainId) {
    return balance > ETHEREUM_THRESHOLD_WEI;
  }
  if (CHAIN_ID_TERRA === chainId) {
    //Terra is complicated because the fees can be paid in multiple currencies.
    return true;
  }

  return true;
};

//TODO move to more generic location
const getBalanceSolana = async (walletAddress: string) => {
  const connection = new Connection(SOLANA_HOST);
  return getMultipleAccountsRPC(connection, [
    new PublicKey(walletAddress),
  ]).then(
    (results) => {
      if (results.length && results[0]) {
        return BigInt(results[0].lamports);
      }
    },
    (error) => {
      return BigInt(0);
    }
  );
};

const getBalanceEth = async (walletAddress: string, provider: Provider) => {
  return provider.getBalance(walletAddress).then((result) => result.toBigInt());
};

const toBalanceString = (balance: bigint | undefined, chainId: ChainId) => {
  if (!chainId || balance === undefined) {
    return "";
  }
  if (chainId === CHAIN_ID_ETH) {
    return formatUnits(balance, 18); //wei decimals
  } else if (chainId === CHAIN_ID_SOLANA) {
    return formatUnits(balance, 9); //lamports to sol decmals
  } else return "";
};

export default function useTransactionFees(chainId: ChainId) {
  const { walletAddress, isReady } = useIsWalletReady(chainId);
  const { provider } = useEthereumProvider();
  const [balance, setBalance] = useState<bigint | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadStart = useCallback(() => {
    setBalance(undefined);
    setIsLoading(true);
    setError("");
  }, []);

  useEffect(() => {
    if (chainId === CHAIN_ID_SOLANA && isReady && walletAddress) {
      loadStart();
      getBalanceSolana(walletAddress).then(
        (result) => {
          const adjustedresult =
            result === undefined || result === null ? BigInt(0) : result;
          setIsLoading(false);
          setBalance(adjustedresult);
        },
        (error) => {
          setIsLoading(false);
          setError("Cannot load wallet balance");
        }
      );
    } else if (chainId === CHAIN_ID_ETH && isReady && walletAddress) {
      if (provider) {
        loadStart();
        getBalanceEth(walletAddress, provider).then(
          (result) => {
            const adjustedresult =
              result === undefined || result === null ? BigInt(0) : result;
            setIsLoading(false);
            setBalance(adjustedresult);
          },
          (error) => {
            setIsLoading(false);
            setError("Cannot load wallet balance");
          }
        );
      }
    }
  }, [provider, walletAddress, isReady, chainId, loadStart]);

  const results = useMemo(() => {
    return {
      isSufficientBalance: isSufficientBalance(chainId, balance),
      balance,
      balanceString: toBalanceString(balance, chainId),
      isLoading,
      error,
    };
  }, [balance, chainId, isLoading, error]);

  return results;
}

export function useEthereumGasPrice(contract: MethodType, chainId: ChainId) {
  const { provider } = useEthereumProvider();
  const { isReady } = useIsWalletReady(chainId);
  const [estimateResults, setEstimateResults] = useState<GasEstimate | null>(
    null
  );

  useEffect(() => {
    if (provider && isReady && !estimateResults) {
      getGasEstimates(provider, contract).then(
        (results) => {
          setEstimateResults(results);
        },
        (error) => {
          console.log(error);
        }
      );
    }
  }, [provider, isReady, estimateResults, contract]);

  const results = useMemo(() => estimateResults, [estimateResults]);
  return results;
}

export function EthGasEstimateSummary({
  methodType,
  chainId,
}: {
  methodType: MethodType;
  chainId: ChainId;
}) {
  const estimate = useEthereumGasPrice(methodType, chainId);
  if (!estimate) {
    return null;
  }

  return (
    <Typography
      component="div"
      style={{
        display: "flex",
        alignItems: "center",
        marginTop: 8,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <LocalGasStation fontSize="inherit" />
        &nbsp;{estimate.currentGasPrice}
      </div>
      <div>&nbsp;&nbsp;&nbsp;</div>
      <div>
        Est. Fees: {estimate.lowEstimate} - {estimate.highEstimate}{" "}
        {getDefaultNativeCurrencySymbol(chainId)}
      </div>
    </Typography>
  );
}

const estimatesByContract = {
  transfer: {
    lowGasEstimate: BigInt(80000),
    highGasEstimate: BigInt(130000),
  },
  nft: {
    lowGasEstimate: BigInt(350000),
    highGasEstimate: BigInt(500000),
  },
  createWrapped: {
    lowGasEstimate: BigInt(450000),
    highGasEstimate: BigInt(700000),
  },
};

export async function getGasEstimates(
  provider: Provider,
  contract: MethodType
): Promise<GasEstimate | null> {
  const lowEstimateGasAmount = estimatesByContract[contract].lowGasEstimate;
  const highEstimateGasAmount = estimatesByContract[contract].highGasEstimate;

  let lowEstimate;
  let highEstimate;
  let currentGasPrice;
  if (provider) {
    const priceInWei = await provider.getGasPrice();
    if (priceInWei) {
      lowEstimate = parseFloat(
        formatUnits(lowEstimateGasAmount * priceInWei.toBigInt(), "ether")
      ).toFixed(4);
      highEstimate = parseFloat(
        formatUnits(highEstimateGasAmount * priceInWei.toBigInt(), "ether")
      ).toFixed(4);
      currentGasPrice = parseFloat(formatUnits(priceInWei, "gwei")).toFixed(0);
    }
  }

  const output =
    currentGasPrice && highEstimate && lowEstimate
      ? {
          currentGasPrice,
          lowEstimate,
          highEstimate,
        }
      : null;

  return output;
}
