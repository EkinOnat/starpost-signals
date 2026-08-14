#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal,
};

struct Fixture {
    env: Env,
    client: ImpactEscrowV1ContractClient<'static>,
    governor: Address,
    guardian: Address,
    payout: Address,
    alice: Address,
    bob: Address,
    asset: Address,
}

fn policy() -> AssetPolicy {
    AssetPolicy {
        enabled_for_new_vaults: true,
        decimals: 7,
        min_contribution: 1,
        max_goal: 1_000_000_000,
    }
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    let governor = Address::generate(&env);
    let guardian = Address::generate(&env);
    let registry = Address::generate(&env);
    let payout = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let asset_contract = env.register_stellar_asset_contract_v2(governor.clone());
    let asset = asset_contract.address();
    StellarAssetClient::new(&env, &asset).mint(&alice, &10_000);
    StellarAssetClient::new(&env, &asset).mint(&bob, &10_000);
    let id = env.register(ImpactEscrowV1Contract, ());
    let client = ImpactEscrowV1ContractClient::new(&env, &id);
    client.initialize(&governor, &guardian, &registry, &asset, &policy());
    Fixture {
        env,
        client,
        governor,
        guardian,
        payout,
        alice,
        bob,
        asset,
    }
}

fn open(f: &Fixture) {
    f.client.open_vault(
        &1,
        &f.payout,
        &f.asset,
        &1_000,
        &1_000,
        &vec![&f.env, 400i128, 600i128],
        &5_000,
    );
}

#[test]
fn requires_governor_auth_to_initialize() {
    let env = Env::default();
    let governor = Address::generate(&env);
    let guardian = Address::generate(&env);
    let registry = Address::generate(&env);
    let asset = Address::generate(&env);
    let id = env.register(ImpactEscrowV1Contract, ());
    let client = ImpactEscrowV1ContractClient::new(&env, &id);
    assert!(client
        .try_initialize(&governor, &guardian, &registry, &asset, &policy())
        .is_err());
}

#[test]
fn direct_wallet_cannot_open_registry_vault() {
    let env = Env::default();
    let governor = Address::generate(&env);
    let guardian = Address::generate(&env);
    let registry = Address::generate(&env);
    let payout = Address::generate(&env);
    let asset = Address::generate(&env);
    let id = env.register(ImpactEscrowV1Contract, ());
    let client = ImpactEscrowV1ContractClient::new(&env, &id);
    client
        .mock_auths(&[MockAuth {
            address: &governor,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (&governor, &guardian, &registry, &asset, policy()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&governor, &guardian, &registry, &asset, &policy());
    assert!(client
        .try_open_vault(
            &1,
            &payout,
            &asset,
            &1_000,
            &1_000,
            &vec![&env, 400i128, 600i128],
            &5_000,
        )
        .is_err());
}

#[test]
fn governor_cannot_bypass_registry_for_coupled_controls() {
    let env = Env::default();
    let governor = Address::generate(&env);
    let guardian = Address::generate(&env);
    let registry = Address::generate(&env);
    let asset = Address::generate(&env);
    let proposed = Address::generate(&env);
    let id = env.register(ImpactEscrowV1Contract, ());
    let client = ImpactEscrowV1ContractClient::new(&env, &id);
    client
        .mock_auths(&[MockAuth {
            address: &governor,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "initialize",
                args: (&governor, &guardian, &registry, &asset, policy()).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&governor, &guardian, &registry, &asset, &policy());
    assert!(client
        .mock_auths(&[MockAuth {
            address: &governor,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "propose_governor",
                args: (&proposed,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_propose_governor(&proposed)
        .is_err());
    assert!(client
        .mock_auths(&[MockAuth {
            address: &guardian,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "set_pause_mode",
                args: (&guardian, PauseMode::PauseRiskyMutations).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_pause_mode(&guardian, &PauseMode::PauseRiskyMutations)
        .is_err());
}

#[test]
fn enforces_allowlist_schedule_and_contribution_cap() {
    let f = setup();
    open(&f);
    assert_eq!(f.client.version(), 1);
    assert_eq!(f.client.get_vault(&1).milestone_amounts.len(), 2);
    assert_eq!(
        f.client.try_deposit(&1, &f.alice, &501),
        Err(Ok(EscrowError::GoalExceeded))
    );
    let unknown = Address::generate(&f.env);
    assert_eq!(
        f.client.try_open_vault(
            &2,
            &f.payout,
            &unknown,
            &1_000,
            &1_000,
            &vec![&f.env, 400i128, 600i128],
            &5_000,
        ),
        Err(Ok(EscrowError::UnsupportedAsset))
    );
}

#[test]
fn exact_release_is_ordered_and_once_only() {
    let f = setup();
    open(&f);
    f.client.deposit(&1, &f.alice, &500);
    f.client.deposit(&1, &f.bob, &500);
    f.client.lock_funding(&1);
    assert_eq!(
        f.client.try_release_milestone(&1, &0, &399),
        Err(Ok(EscrowError::WrongReleaseAmount))
    );
    assert_eq!(
        f.client.try_release_milestone(&1, &1, &600),
        Err(Ok(EscrowError::WrongMilestone))
    );
    f.client.release_milestone(&1, &0, &400);
    assert_eq!(f.client.release_receipt(&1, &0), Some(400));
    assert_eq!(TokenClient::new(&f.env, &f.asset).balance(&f.payout), 400);
    assert_eq!(
        f.client.try_release_milestone(&1, &0, &400),
        Err(Ok(EscrowError::WrongMilestone))
    );
}

#[test]
fn partial_refunds_conserve_every_atomic_unit() {
    let f = setup();
    open(&f);
    f.client.deposit(&1, &f.alice, &500);
    f.client.deposit(&1, &f.bob, &500);
    f.client.lock_funding(&1);
    f.client.release_milestone(&1, &0, &400);
    assert_eq!(f.client.enable_refunds(&1), 600);
    assert_eq!(f.client.claim_refund(&1, &f.alice), 300);
    assert_eq!(f.client.claim_refund(&1, &f.bob), 300);
    let vault = f.client.get_vault(&1);
    assert_eq!(vault.deposited, 1_000);
    assert_eq!(vault.released, 400);
    assert_eq!(vault.refunded_total, 600);
    assert_eq!(vault.remaining_pool, 0);
    assert_eq!(vault.deposited, vault.released + vault.refunded_total);
}

#[test]
fn refunds_remain_available_during_full_pause() {
    let f = setup();
    open(&f);
    f.client.deposit(&1, &f.alice, &500);
    f.client.enable_refunds(&1);
    f.client
        .set_pause_mode(&f.guardian, &PauseMode::PauseRiskyMutations);
    assert_eq!(f.client.claim_refund(&1, &f.alice), 500);
}

#[test]
fn guardian_cannot_unpause() {
    let f = setup();
    f.client
        .set_pause_mode(&f.guardian, &PauseMode::PauseRiskyMutations);
    assert_eq!(
        f.client
            .try_set_pause_mode(&f.guardian, &PauseMode::Running),
        Err(Ok(EscrowError::InvalidPauseTransition))
    );
    f.client.set_pause_mode(&f.governor, &PauseMode::Running);
    assert_eq!(f.client.get_config().pause_mode, PauseMode::Running);
}

#[test]
fn funding_deadline_uses_the_same_pause_clock_as_registry() {
    let f = setup();
    f.client.open_vault(
        &1,
        &f.payout,
        &f.asset,
        &1_000,
        &200,
        &vec![&f.env, 400i128, 600i128],
        &5_000,
    );
    f.env.ledger().set_timestamp(150);
    f.client
        .set_pause_mode(&f.guardian, &PauseMode::PauseRiskyMutations);
    f.env.ledger().set_timestamp(1_000);
    f.client.set_pause_mode(&f.governor, &PauseMode::Running);
    f.env.ledger().set_timestamp(1_049);
    assert_eq!(f.client.deposit(&1, &f.alice, &500), 500);
    f.env.ledger().set_timestamp(1_050);
    assert_eq!(
        f.client.try_deposit(&1, &f.bob, &500),
        Err(Ok(EscrowError::FundingClosed))
    );
}

#[test]
fn refund_rounding_assigns_only_residual_dust() {
    let f = setup();
    f.client.open_vault(
        &1,
        &f.payout,
        &f.asset,
        &3,
        &1_000,
        &vec![&f.env, 1i128, 2i128],
        &6_667,
    );
    f.client.deposit(&1, &f.alice, &1);
    f.client.deposit(&1, &f.bob, &2);
    f.client.lock_funding(&1);
    f.client.release_milestone(&1, &0, &1);
    f.client.enable_refunds(&1);
    let first = f.client.claim_refund(&1, &f.alice);
    let last = f.client.claim_refund(&1, &f.bob);
    assert_eq!(first + last, 2);
    assert_eq!(f.client.get_vault(&1).remaining_pool, 0);
}
