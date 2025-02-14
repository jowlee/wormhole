import { CHAIN_ID_SOLANA } from "@certusone/wormhole-sdk";
import {
  CircularProgress,
  TextField,
  Typography,
  createStyles,
  makeStyles,
} from "@material-ui/core";
import { Alert, Autocomplete } from "@material-ui/lab";
import { createFilterOptions } from "@material-ui/lab/Autocomplete";
import { TokenInfo } from "@solana/spl-token-registry";
import React, { useCallback, useMemo } from "react";
import useMetaplexData from "../../hooks/useMetaplexData";
import useSolanaTokenMap from "../../hooks/useSolanaTokenMap";
import { DataWrapper } from "../../store/helpers";
import { NFTParsedTokenAccount } from "../../store/nftSlice";
import { ParsedTokenAccount } from "../../store/transferSlice";
import {
  MIGRATION_ASSET_MAP,
  WORMHOLE_V1_MINT_AUTHORITY,
} from "../../utils/consts";
import { ExtractedMintInfo, shortenAddress } from "../../utils/solana";
import { sortParsedTokenAccounts } from "../../utils/sort";
import NFTViewer from "./NFTViewer";
import RefreshButtonWrapper from "./RefreshButtonWrapper";

const useStyles = makeStyles((theme) =>
  createStyles({
    selectInput: { minWidth: "10rem" },
    tokenOverviewContainer: {
      display: "flex",
      width: "100%",
      alignItems: "center",
      "& div": {
        margin: theme.spacing(1),
        flexBasis: "33%",
        "&$tokenImageContainer": {
          maxWidth: 40,
        },
        "&:last-child": {
          textAlign: "right",
        },
      },
    },
    tokenImageContainer: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 40,
    },
    tokenImage: {
      maxHeight: "2.5rem", //Eyeballing this based off the text size
    },
    v1Warning: {
      width: "100%",
    },
    migrationAlert: {
      width: "100%",
      "& .MuiAlert-message": {
        width: "100%",
      },
    },
  })
);

type SolanaSourceTokenSelectorProps = {
  value: ParsedTokenAccount | null;
  onChange: (newValue: NFTParsedTokenAccount | null) => void;
  accounts: ParsedTokenAccount[];
  disabled: boolean;
  mintAccounts:
    | DataWrapper<Map<string, ExtractedMintInfo | null> | undefined>
    | undefined;
  resetAccounts: (() => void) | undefined;
  nft?: boolean;
};

const getOptionSelected = (
  option: ParsedTokenAccount,
  value: ParsedTokenAccount
) => option.mintKey === value.mintKey && option.publicKey === value.publicKey;

export default function SolanaSourceTokenSelector(
  props: SolanaSourceTokenSelectorProps
) {
  const { value, onChange, disabled, resetAccounts, nft, mintAccounts } = props;
  const classes = useStyles();

  const resetAccountWrapper = resetAccounts || (() => {}); //This should never happen.
  const solanaTokenMap = useSolanaTokenMap();

  const mintAddresses = useMemo(() => {
    const output: string[] = [];
    mintAccounts?.data?.forEach(
      (mintAuth, mintAddress) => mintAddress && output.push(mintAddress)
    );
    return output;
  }, [mintAccounts?.data]);

  const metaplex = useMetaplexData(mintAddresses);

  const memoizedTokenMap: Map<String, TokenInfo> = useMemo(() => {
    const output = new Map<String, TokenInfo>();

    if (solanaTokenMap.data) {
      for (const data of solanaTokenMap.data) {
        if (data && data.address) {
          output.set(data.address, data);
        }
      }
    }

    return output;
  }, [solanaTokenMap]);

  const getLogo = useCallback(
    (account: ParsedTokenAccount) => {
      return (
        (account.isNativeAsset && account.logo) ||
        memoizedTokenMap.get(account.mintKey)?.logoURI ||
        metaplex.data?.get(account.mintKey)?.data?.uri ||
        undefined
      );
    },
    [memoizedTokenMap, metaplex]
  );

  const getSymbol = useCallback(
    (account: ParsedTokenAccount) => {
      return (
        (account.isNativeAsset && account.symbol) ||
        memoizedTokenMap.get(account.mintKey)?.symbol ||
        metaplex.data?.get(account.mintKey)?.data?.symbol ||
        undefined
      );
    },
    [memoizedTokenMap, metaplex]
  );

  const getName = useCallback(
    (account: ParsedTokenAccount) => {
      return (
        (account.isNativeAsset && account.name) ||
        memoizedTokenMap.get(account.mintKey)?.name ||
        metaplex.data?.get(account.mintKey)?.data?.name ||
        undefined
      );
    },
    [memoizedTokenMap, metaplex]
  );

  //I wish there was a way  to make this more intelligent,
  //but the autocomplete filterConfig options seem pretty limiting.
  const filterConfig = createFilterOptions({
    matchFrom: "any",
    stringify: (option: ParsedTokenAccount) => {
      const symbol = getSymbol(option) + " " || "";
      const name = getName(option) + " " || "";
      const mint = option.mintKey + " ";
      const pubkey = option.publicKey + " ";

      return symbol + name + mint + pubkey;
    },
  });

  const isWormholev1 = useCallback(
    (address: string) => {
      //This is a v1 wormhole token on testnet
      //const testAddress = "4QixXecTZ4zdZGa39KH8gVND5NZ2xcaB12wiBhE4S7rn";

      if (!props.mintAccounts?.data) {
        return true; //These should never be null by this point
      }
      const mintAuthority = props.mintAccounts.data.get(address)?.mintAuthority;

      if (!mintAuthority) {
        return true; //We should never fail to pull the mint of an account.
      }

      if (mintAuthority === WORMHOLE_V1_MINT_AUTHORITY) {
        return true; //This means the mint was created by the wormhole v1 contract, and we want to disallow its transfer.
      }

      return false;
    },
    [props.mintAccounts]
  );

  const isMigrationEligible = useCallback((address: string) => {
    return !!MIGRATION_ASSET_MAP.get(address);
  }, []);

  const renderAccount = useCallback(
    (account: ParsedTokenAccount) => {
      const mintPrettyString = shortenAddress(account.mintKey);
      const accountAddressPrettyString = shortenAddress(account.publicKey);
      const uri = getLogo(account);
      const symbol = getSymbol(account) || "Unknown";
      const name = getName(account) || "--";

      const content = (
        <div className={classes.tokenOverviewContainer}>
          <div className={classes.tokenImageContainer}>
            {uri && <img alt="" className={classes.tokenImage} src={uri} />}
          </div>
          <div>
            <Typography variant="subtitle1">{symbol}</Typography>
            <Typography variant="subtitle2">{name}</Typography>
          </div>
          <div>
            {account.isNativeAsset ? (
              <Typography>{"Native"}</Typography>
            ) : (
              <>
                <Typography variant="body1">
                  {"Mint : " + mintPrettyString}
                </Typography>
                <Typography variant="body1">
                  {"Account :" + accountAddressPrettyString}
                </Typography>
              </>
            )}
          </div>
          {nft ? null : (
            <div>
              <Typography variant="body2">{"Balance"}</Typography>
              <Typography variant="h6">{account.uiAmountString}</Typography>
            </div>
          )}
        </div>
      );

      const v1Warning = (
        <div className={classes.v1Warning}>
          <Typography variant="body2">
            Wormhole v1 tokens are not eligible for transfer.
          </Typography>
          <div>{content}</div>
        </div>
      );

      const migrationRender = (
        <div className={classes.migrationAlert}>
          <Alert severity="warning" variant="outlined">
            <Typography variant="body2">
              This is a legacy asset eligible for migration.
            </Typography>
            <div>{content}</div>
          </Alert>
        </div>
      );

      return isMigrationEligible(account.mintKey)
        ? migrationRender
        : isWormholev1(account.mintKey)
        ? v1Warning
        : content;
    },
    [
      getLogo,
      getSymbol,
      getName,
      classes,
      isWormholev1,
      isMigrationEligible,
      nft,
    ]
  );

  //The autocomplete doesn't rerender the option label unless the value changes.
  //Thus we should wait for the metadata to arrive before rendering it.
  //TODO This can flicker dependent on how fast the useEffects in the getSourceAccounts hook complete.
  const isLoading =
    metaplex.isFetching ||
    solanaTokenMap.isFetching ||
    props.mintAccounts?.isFetching;

  const accountLoadError =
    props.mintAccounts?.error && "Unable to retrieve your token accounts";
  const error = accountLoadError;

  //This exists to remove NFTs from the list of potential options. It requires reading the metaplex data, so it would be
  //difficult to do before this point.
  const filteredOptions = useMemo(() => {
    const tokenList = props.accounts
      .filter((x) => {
        const zeroBalance = x.amount === "0";
        if (zeroBalance) {
          return false;
        }
        const isNFT =
          x.decimals === 0 &&
          metaplex.data?.get(x.mintKey)?.data?.uri &&
          mintAccounts?.data?.get(x.mintKey)?.supply === "1";
        return nft ? isNFT : !isNFT;
      })
      .map((account) => ({
        ...account,
        symbol: account.symbol || getSymbol(account) || undefined,
      }));
    tokenList.sort(sortParsedTokenAccounts);
    return tokenList;
  }, [mintAccounts?.data, metaplex.data, nft, props.accounts, getSymbol]);

  const isOptionDisabled = useMemo(() => {
    return (value: ParsedTokenAccount) => {
      return isWormholev1(value.mintKey) && !isMigrationEligible(value.mintKey);
    };
  }, [isWormholev1, isMigrationEligible]);

  const onAutocompleteChange = useCallback(
    (event, newValue: NFTParsedTokenAccount | null) => {
      if (!newValue) {
        onChange(null);
        return;
      }
      const symbol = getSymbol(newValue);
      const name = getName(newValue);
      const logo = getLogo(newValue);
      // TODO: more nft data

      onChange({
        ...newValue,
        symbol,
        name,
        logo: nft ? undefined : logo,
        uri: nft ? logo : undefined,
      });
    },
    [getSymbol, getName, getLogo, onChange, nft]
  );

  const renderInput = useCallback(
    (params) => (
      <TextField
        {...params}
        label={nft ? "NFT Account" : "Token Account"}
        variant="outlined"
      />
    ),
    [nft]
  );

  const getOptionLabel = useCallback(
    (option: ParsedTokenAccount) => {
      const symbol = getSymbol(option);
      const label = option.isNativeAsset
        ? symbol || "" //default for non-null guarantee
        : `${symbol ? symbol : "Unknown"} (Account: ${shortenAddress(
            option.publicKey
          )}, Mint: ${shortenAddress(option.mintKey)})`;

      return label;
    },
    [getSymbol]
  );

  const autoComplete = (
    <Autocomplete
      autoComplete
      autoHighlight
      blurOnSelect
      clearOnBlur
      fullWidth={false}
      filterOptions={filterConfig}
      value={value}
      onChange={onAutocompleteChange}
      disabled={disabled}
      options={filteredOptions}
      renderInput={renderInput}
      renderOption={renderAccount}
      getOptionDisabled={isOptionDisabled}
      getOptionLabel={getOptionLabel}
      getOptionSelected={getOptionSelected}
    />
  );

  const wrappedContent = (
    <RefreshButtonWrapper callback={resetAccountWrapper}>
      {autoComplete}
    </RefreshButtonWrapper>
  );

  return (
    <React.Fragment>
      {isLoading ? <CircularProgress /> : wrappedContent}
      {error && <Typography color="error">{error}</Typography>}
      {nft && value ? (
        <NFTViewer value={value} chainId={CHAIN_ID_SOLANA} />
      ) : null}
    </React.Fragment>
  );
}
