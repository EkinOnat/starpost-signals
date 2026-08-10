#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

struct Fixture {
    env: Env,
    client: GrantEscrowContractClient<'static>,
    admin: Address,
    registry: Address,
    creator: Address,
    contributor: Address,
    asset: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    let admin = Address::generate(&env);
    let registry = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);
    let asset_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = asset_contract.address();
    StellarAssetClient::new(&env, &asset).mint(&contributor, &10_000);
    let contract_id = env.register(GrantEscrowContract, ());
    let client = GrantEscrowContractClient::new(&env, &contract_id);
    client.initialize(&admin, &registry);
    Fixture {
        env,
        client,
        admin,
        registry,
        creator,
        contributor,
        asset,
    }
}

fn open(f: &Fixture, goal: i128) {
    f.client.open_grant(&1, &f.creator, &f.asset, &goal, &1_000);
}

#[test]
fn initializes_once() {
    let f = setup();
    assert_eq!(
        f.client.try_initialize(&f.admin, &f.registry),
        Err(Ok(EscrowError::AlreadyInitialized))
    );
}

#[test]
fn opens_and_reads_vault() {
    let f = setup();
    open(&f, 1_000);
    let vault = f.client.get_vault(&1);
    assert_eq!(vault.goal, 1_000);
    assert_eq!(vault.deposited, 0);
    assert_eq!(vault.creator, f.creator);
}

#[test]
fn rejects_duplicate_vault() {
    let f = setup();
    open(&f, 1_000);
    assert_eq!(
        f.client
            .try_open_grant(&1, &f.creator, &f.asset, &1_000, &1_000),
        Err(Ok(EscrowError::VaultExists))
    );
}

#[test]
fn rejects_invalid_vault_inputs() {
    let f = setup();
    assert_eq!(
        f.client
            .try_open_grant(&1, &f.creator, &f.asset, &0, &1_000),
        Err(Ok(EscrowError::InvalidAmount))
    );
    assert_eq!(
        f.client
            .try_open_grant(&2, &f.creator, &f.asset, &100, &100),
        Err(Ok(EscrowError::InvalidDeadline))
    );
}

#[test]
fn contribution_moves_asset_and_accumulates() {
    let f = setup();
    open(&f, 1_000);
    assert_eq!(f.client.contribute(&1, &f.contributor, &250), 250);
    assert_eq!(f.client.contribute(&1, &f.contributor, &150), 400);
    assert_eq!(f.client.contribution(&1, &f.contributor), 400);
    assert_eq!(f.client.total(&1), 400);
    assert_eq!(
        TokenClient::new(&f.env, &f.asset).balance(&f.contributor),
        9_600
    );
    assert_eq!(
        TokenClient::new(&f.env, &f.asset).balance(&f.client.address),
        400
    );
}

#[test]
fn rejects_non_positive_contribution() {
    let f = setup();
    open(&f, 1_000);
    assert_eq!(
        f.client.try_contribute(&1, &f.contributor, &0),
        Err(Ok(EscrowError::InvalidAmount))
    );
}

#[test]
fn caps_funding_at_goal() {
    let f = setup();
    open(&f, 500);
    f.client.contribute(&1, &f.contributor, &400);
    assert_eq!(
        f.client.try_contribute(&1, &f.contributor, &101),
        Err(Ok(EscrowError::GoalExceeded))
    );
}

#[test]
fn closes_funding_at_deadline() {
    let f = setup();
    open(&f, 500);
    f.env.ledger().set_timestamp(1_000);
    assert_eq!(
        f.client.try_contribute(&1, &f.contributor, &100),
        Err(Ok(EscrowError::FundingClosed))
    );
}

#[test]
fn registry_release_moves_exact_asset() {
    let f = setup();
    open(&f, 1_000);
    f.client.contribute(&1, &f.contributor, &1_000);
    f.client.release(&1, &0, &400);
    let vault = f.client.get_vault(&1);
    assert_eq!(vault.released, 400);
    assert_eq!(TokenClient::new(&f.env, &f.asset).balance(&f.creator), 400);
}

#[test]
fn rejects_release_beyond_deposits() {
    let f = setup();
    open(&f, 1_000);
    f.client.contribute(&1, &f.contributor, &250);
    assert_eq!(
        f.client.try_release(&1, &0, &251),
        Err(Ok(EscrowError::ReleaseExceeded))
    );
}

#[test]
fn enables_and_claims_refund_once() {
    let f = setup();
    open(&f, 1_000);
    f.client.contribute(&1, &f.contributor, &350);
    f.client.set_refundable(&1);
    assert_eq!(f.client.claim_refund(&1, &f.contributor), 350);
    assert_eq!(
        TokenClient::new(&f.env, &f.asset).balance(&f.contributor),
        10_000
    );
    assert_eq!(
        f.client.try_claim_refund(&1, &f.contributor),
        Err(Ok(EscrowError::AlreadyRefunded))
    );
}

#[test]
fn rejects_refund_before_enabled() {
    let f = setup();
    open(&f, 1_000);
    f.client.contribute(&1, &f.contributor, &100);
    assert_eq!(
        f.client.try_claim_refund(&1, &f.contributor),
        Err(Ok(EscrowError::RefundUnavailable))
    );
}

#[test]
fn rejects_refund_for_non_contributor() {
    let f = setup();
    open(&f, 1_000);
    f.client.set_refundable(&1);
    assert_eq!(
        f.client.try_claim_refund(&1, &f.contributor),
        Err(Ok(EscrowError::NothingToRefund))
    );
}

#[test]
fn refuses_refundable_after_release() {
    let f = setup();
    open(&f, 1_000);
    f.client.contribute(&1, &f.contributor, &1_000);
    f.client.release(&1, &0, &400);
    assert_eq!(
        f.client.try_set_refundable(&1),
        Err(Ok(EscrowError::RefundUnavailable))
    );
}

#[test]
fn pause_blocks_financial_mutations() {
    let f = setup();
    open(&f, 1_000);
    f.client.set_paused(&true);
    assert_eq!(
        f.client.try_contribute(&1, &f.contributor, &100),
        Err(Ok(EscrowError::Paused))
    );
    f.client.set_paused(&false);
    assert_eq!(f.client.contribute(&1, &f.contributor, &100), 100);
}

#[test]
fn publishes_lifecycle_events() {
    let f = setup();
    open(&f, 1_000);
    f.client.contribute(&1, &f.contributor, &100);
    f.client.set_refundable(&1);
    f.client.claim_refund(&1, &f.contributor);
    // The test environment exposes the most recent invocation's events: the
    // native asset transfer plus the escrow's RefundClaimed event.
    assert_eq!(f.env.events().all().events().len(), 2);
}
