use cosmwasm_std::{
    entry_point,
    to_binary,
    Binary,
    CosmosMsg,
    Deps,
    DepsMut,
    Env,
    MessageInfo,
    Response,
    StdError,
    StdResult,
    Uint128,
    WasmMsg,
};

use cw2::set_contract_version;
use cw20_legacy::{
    allowances::{
        execute_burn_from,
        execute_decrease_allowance,
        execute_increase_allowance,
        execute_send_from,
        execute_transfer_from,
        query_allowance,
    },
    contract::{
        execute_mint,
        execute_send,
        execute_transfer,
        query_balance,
    },
    state::{
        MinterData,
        TokenInfo,
        TOKEN_INFO,
    },
    ContractError,
};

use crate::{
    msg::{
        ExecuteMsg,
        InstantiateMsg,
        QueryMsg,
        WrappedAssetInfoResponse,
    },
    state::{
        wrapped_asset_info,
        wrapped_asset_info_read,
        WrappedAssetInfo,
    },
};
use cw20::TokenInfoResponse;
use std::string::String;

type HumanAddr = String;

// version info for migration info
const CONTRACT_NAME: &str = "crates.io:cw20-base";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    // store token info using cw20-base format
    let data = TokenInfo {
        name: msg.name,
        symbol: msg.symbol,
        decimals: msg.decimals,
        total_supply: Uint128::new(0),
        // set creator as minter
        mint: Some(MinterData {
            minter: deps.api.addr_canonicalize(&info.sender.as_str())?,
            cap: None,
        }),
    };
    TOKEN_INFO.save(deps.storage, &data)?;

    // save wrapped asset info
    let data = WrappedAssetInfo {
        asset_chain: msg.asset_chain,
        asset_address: msg.asset_address,
        bridge: deps.api.addr_canonicalize(&info.sender.as_str())?,
    };
    wrapped_asset_info(deps.storage).save(&data)?;

    if let Some(mint_info) = msg.mint {
        execute_mint(deps, env, info, mint_info.recipient, mint_info.amount)
            .map_err(|e| StdError::generic_err(format!("{}", e)))?;
    }

    if let Some(hook) = msg.init_hook {
        Ok(
            Response::new().add_message(CosmosMsg::Wasm(WasmMsg::Execute {
                contract_addr: hook.contract_addr,
                msg: hook.msg,
                funds: vec![],
            })),
        )
    } else {
        Ok(Response::default())
    }
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        // these all come from cw20-base to implement the cw20 standard
        ExecuteMsg::Transfer { recipient, amount } => {
            Ok(execute_transfer(deps, env, info, recipient, amount)?)
        }
        ExecuteMsg::Burn { account, amount } => {
            Ok(execute_burn_from(deps, env, info, account, amount)?)
        }
        ExecuteMsg::Send {
            contract,
            amount,
            msg,
        } => Ok(execute_send(deps, env, info, contract, amount, msg)?),
        ExecuteMsg::Mint { recipient, amount } => {
            execute_mint_wrapped(deps, env, info, recipient, amount)
        }
        ExecuteMsg::IncreaseAllowance {
            spender,
            amount,
            expires,
        } => Ok(execute_increase_allowance(
            deps, env, info, spender, amount, expires,
        )?),
        ExecuteMsg::DecreaseAllowance {
            spender,
            amount,
            expires,
        } => Ok(execute_decrease_allowance(
            deps, env, info, spender, amount, expires,
        )?),
        ExecuteMsg::TransferFrom {
            owner,
            recipient,
            amount,
        } => Ok(execute_transfer_from(
            deps, env, info, owner, recipient, amount,
        )?),
        ExecuteMsg::BurnFrom { owner, amount } => {
            Ok(execute_burn_from(deps, env, info, owner, amount)?)
        }
        ExecuteMsg::SendFrom {
            owner,
            contract,
            amount,
            msg,
        } => Ok(execute_send_from(
            deps, env, info, owner, contract, amount, msg,
        )?),
        ExecuteMsg::UpdateMetadata { name, symbol } => {
            Ok(execute_update_metadata(deps, env, info, name, symbol)?)
        }
    }
}

fn execute_mint_wrapped(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    recipient: HumanAddr,
    amount: Uint128,
) -> Result<Response, ContractError> {
    // Only bridge can mint
    let wrapped_info = wrapped_asset_info_read(deps.storage).load()?;
    if wrapped_info.bridge != deps.api.addr_canonicalize(&info.sender.as_str())? {
        return Err(ContractError::Unauthorized {});
    }

    Ok(execute_mint(deps, env, info, recipient, amount)?)
}

fn execute_update_metadata(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    name: String,
    symbol: String,
) -> Result<Response, ContractError> {
    // Only bridge can update.
    let wrapped_info = wrapped_asset_info_read(deps.storage).load()?;
    if wrapped_info.bridge != deps.api.addr_canonicalize(&info.sender.as_str())? {
        return Err(ContractError::Unauthorized {});
    }

    let mut state = TOKEN_INFO.load(deps.storage)?;
    state.name = name;
    state.symbol = symbol;
    TOKEN_INFO.save(deps.storage, &state)?;
    Ok(Response::default())
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::WrappedAssetInfo {} => to_binary(&query_wrapped_asset_info(deps)?),
        // inherited from cw20-base
        QueryMsg::TokenInfo {} => to_binary(&query_token_info(deps)?),
        QueryMsg::Balance { address } => to_binary(&query_balance(deps, address)?),
        QueryMsg::Allowance { owner, spender } => {
            to_binary(&query_allowance(deps, owner, spender)?)
        }
    }
}

pub fn query_token_info(deps: Deps) -> StdResult<TokenInfoResponse> {
    let info = TOKEN_INFO.load(deps.storage)?;
    Ok(TokenInfoResponse {
        name: String::from("Wormhole:") + info.name.as_str(),
        symbol: String::from("wh") + info.symbol.as_str(),
        decimals: info.decimals,
        total_supply: info.total_supply,
    })
}

pub fn query_wrapped_asset_info(deps: Deps) -> StdResult<WrappedAssetInfoResponse> {
    let info = wrapped_asset_info_read(deps.storage).load()?;
    Ok(WrappedAssetInfoResponse {
        asset_chain: info.asset_chain,
        asset_address: info.asset_address,
        bridge: deps.api.addr_humanize(&info.bridge)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{
        mock_dependencies,
        mock_env,
        mock_info,
    };
    use cw20::TokenInfoResponse;

    const CANONICAL_LENGTH: usize = 20;

    fn get_balance(deps: Deps, address: HumanAddr) -> Uint128 {
        query_balance(deps, address.into()).unwrap().balance
    }

    fn do_init(mut deps: DepsMut, creator: &HumanAddr) {
        let init_msg = InstantiateMsg {
            name: "Integers".to_string(),
            symbol: "INT".to_string(),
            asset_chain: 1,
            asset_address: vec![1; 32].into(),
            decimals: 10,
            mint: None,
            init_hook: None,
        };
        let env = mock_env();
        let info = mock_info(creator, &[]);
        let res = instantiate(deps, env, info, init_msg).unwrap();
        assert_eq!(0, res.messages.len());

        assert_eq!(
            query_token_info(deps.as_ref()).unwrap(),
            TokenInfoResponse {
                name: "Wormhole Wrapped".to_string(),
                symbol: "WWT".to_string(),
                decimals: 10,
                total_supply: Uint128::from(0u128),
            }
        );

        assert_eq!(
            query_wrapped_asset_info(deps.as_ref()).unwrap(),
            WrappedAssetInfoResponse {
                asset_chain: 1,
                asset_address: vec![1; 32].into(),
                bridge: deps.api.addr_validate(creator).unwrap(),
            }
        );
    }

    fn do_init_and_mint(
        mut deps: DepsMut,
        creator: &HumanAddr,
        mint_to: &HumanAddr,
        amount: Uint128,
    ) {
        do_init(deps, creator);

        let msg = ExecuteMsg::Mint {
            recipient: mint_to.clone(),
            amount,
        };

        let env = mock_env();
        let info = mock_info(creator, &[]);
        let res = execute(deps.as_mut(), env, info, msg.clone()).unwrap();
        assert_eq!(0, res.messages.len());
        assert_eq!(get_balance(deps.as_ref(), mint_to.clone(),), amount);

        assert_eq!(
            query_token_info(deps.as_ref()).unwrap(),
            TokenInfoResponse {
                name: "Wormhole Wrapped".to_string(),
                symbol: "WWT".to_string(),
                decimals: 10,
                total_supply: amount,
            }
        );
    }

    #[test]
    fn can_mint_by_minter() {
        let mut deps = mock_dependencies(&[]);
        let minter = HumanAddr::from("minter");
        let recipient = HumanAddr::from("recipient");
        let amount = Uint128::new(222_222_222);
        do_init_and_mint(deps.as_mut(), &minter, &recipient, amount);
    }

    #[test]
    fn others_cannot_mint() {
        let mut deps = mock_dependencies(&[]);
        let minter = HumanAddr::from("minter");
        let recipient = HumanAddr::from("recipient");
        do_init(deps.as_mut(), &minter);

        let amount = Uint128::new(222_222_222);
        let msg = ExecuteMsg::Mint {
            recipient: recipient.clone(),
            amount,
        };

        let other_address = HumanAddr::from("other");
        let env = mock_env();
        let info = mock_info(&other_address, &[]);
        let res = execute(deps.as_mut(), env, info, msg);
        assert_eq!(
            format!("{}", res.unwrap_err()),
            format!("{}", crate::error::ContractError::Unauthorized {})
        );
    }

    #[test]
    fn transfer_balance_success() {
        let mut deps = mock_dependencies(&[]);
        let minter = HumanAddr::from("minter");
        let owner = HumanAddr::from("owner");
        let amount_initial = Uint128::new(222_222_222);
        do_init_and_mint(deps.as_mut(), &minter, &owner, amount_initial);

        // Transfer
        let recipient = HumanAddr::from("recipient");
        let amount_transfer = Uint128::new(222_222);
        let msg = ExecuteMsg::Transfer {
            recipient: recipient.clone(),
            amount: amount_transfer,
        };

        let env = mock_env();
        let info = mock_info(&owner, &[]);
        let res = execute(deps.as_mut(), env, info, msg.clone()).unwrap();
        assert_eq!(0, res.messages.len());
        assert_eq!(get_balance(deps.as_ref(), owner), Uint128::new(222_000_000));
        assert_eq!(get_balance(deps.as_ref(), recipient), amount_transfer);
    }

    #[test]
    fn transfer_balance_not_enough() {
        let mut deps = mock_dependencies(&[]);
        let minter = HumanAddr::from("minter");
        let owner = HumanAddr::from("owner");
        let amount_initial = Uint128::new(222_221);
        do_init_and_mint(deps.as_mut(), &minter, &owner, amount_initial);

        // Transfer
        let recipient = HumanAddr::from("recipient");
        let amount_transfer = Uint128::new(222_222);
        let msg = ExecuteMsg::Transfer {
            recipient: recipient.clone(),
            amount: amount_transfer,
        };

        let env = mock_env();
        let info = mock_info(&owner, &[]);
        let _ = execute(deps.as_mut(), env, info, msg.clone()).unwrap_err(); // Will panic if no error
    }
}
