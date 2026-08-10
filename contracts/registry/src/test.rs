#![cfg(test)]

use super::*;
use grant_escrow::{GrantEscrowContract, GrantEscrowContractClient};
use signals::{SignalsContract, SignalsContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, String,
};

struct Fixture {
    env: Env,
    registry: GrantRegistryContractClient<'static>,
    escrow: GrantEscrowContractClient<'static>,
    admin: Address,
    creator: Address,
    contributor: Address,
    outsider: Address,
    asset: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    let admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);
    let outsider = Address::generate(&env);
    let signals_id = env.register(SignalsContract, ());
    let registry_id = env.register(GrantRegistryContract, ());
    let escrow_id = env.register(GrantEscrowContract, ());
    let asset_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let asset = asset_contract.address();
    StellarAssetClient::new(&env, &asset).mint(&contributor, &10_000);

    let signals = SignalsContractClient::new(&env, &signals_id);
    signals.initialize(
        &admin,
        &String::from_str(&env, "What should Stellar build next?"),
        &vec![
            &env,
            String::from_str(&env, "Payments"),
            String::from_str(&env, "Identity"),
            String::from_str(&env, "Climate"),
            String::from_str(&env, "Gaming"),
        ],
    );
    let escrow = GrantEscrowContractClient::new(&env, &escrow_id);
    escrow.initialize(&admin, &registry_id);
    let registry = GrantRegistryContractClient::new(&env, &registry_id);
    registry.initialize(&admin, &signals_id, &escrow_id);

    Fixture {
        env,
        registry,
        escrow,
        admin,
        creator,
        contributor,
        outsider,
        asset,
    }
}

fn schedule(env: &Env) -> Vec<MilestoneInput> {
    vec![
        env,
        MilestoneInput {
            title: String::from_str(env, "Prototype"),
            amount: 400,
        },
        MilestoneInput {
            title: String::from_str(env, "Launch"),
            amount: 600,
        },
    ]
}

fn create(f: &Fixture) -> u64 {
    f.registry.create_grant(
        &f.creator,
        &0,
        &String::from_str(&f.env, "Open payment rails"),
        &f.asset,
        &1_000,
        &1_000,
        &schedule(&f.env),
        &6_000,
        &5_000,
    )
}

fn fund_and_activate(f: &Fixture) -> u64 {
    let id = create(f);
    f.escrow.contribute(&id, &f.contributor, &1_000);
    assert!(f.registry.finalize_funding(&id));
    id
}

#[test]
fn initializes_once() {
    let f = setup();
    assert!(matches!(
        f.registry
            .try_initialize(&f.admin, &f.outsider, &f.outsider),
        Err(Ok(RegistryError::AlreadyInitialized))
    ));
}

#[test]
fn creates_grant_and_opens_vault() {
    let f = setup();
    let id = create(&f);
    let grant = f.registry.get_grant(&id);
    let vault = f.escrow.get_vault(&id);
    assert_eq!(grant.category, 0);
    assert_eq!(grant.status, GrantStatus::Funding);
    assert_eq!(vault.goal, grant.goal);
    assert_eq!(f.registry.get_milestones(&id).len(), 2);
}

#[test]
fn validates_category_against_signals_contract() {
    let f = setup();
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &9,
            &String::from_str(&f.env, "Unknown"),
            &f.asset,
            &1_000,
            &1_000,
            &schedule(&f.env),
            &6_000,
            &5_000,
        ),
        Err(Ok(RegistryError::InvalidCategory))
    );
}

#[test]
fn rejects_invalid_goal_and_deadline() {
    let f = setup();
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &0,
            &String::from_str(&f.env, "Bad goal"),
            &f.asset,
            &0,
            &1_000,
            &schedule(&f.env),
            &6_000,
            &5_000,
        ),
        Err(Ok(RegistryError::InvalidGoal))
    );
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &0,
            &String::from_str(&f.env, "Bad deadline"),
            &f.asset,
            &1_000,
            &100,
            &schedule(&f.env),
            &6_000,
            &5_000,
        ),
        Err(Ok(RegistryError::InvalidDeadline))
    );
}

#[test]
fn rejects_milestone_count_and_sum() {
    let f = setup();
    let one = vec![
        &f.env,
        MilestoneInput {
            title: String::from_str(&f.env, "Only"),
            amount: 1_000,
        },
    ];
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &0,
            &String::from_str(&f.env, "One step"),
            &f.asset,
            &1_000,
            &1_000,
            &one,
            &6_000,
            &5_000,
        ),
        Err(Ok(RegistryError::InvalidMilestones))
    );
    let mut wrong_sum = schedule(&f.env);
    let mut first = wrong_sum.get(0).unwrap();
    first.amount = 399;
    wrong_sum.set(0, first);
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &0,
            &String::from_str(&f.env, "Wrong sum"),
            &f.asset,
            &1_000,
            &1_000,
            &wrong_sum,
            &6_000,
            &5_000,
        ),
        Err(Ok(RegistryError::InvalidMilestones))
    );
}

#[test]
fn rejects_invalid_thresholds() {
    let f = setup();
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &0,
            &String::from_str(&f.env, "Threshold"),
            &f.asset,
            &1_000,
            &1_000,
            &schedule(&f.env),
            &10_001,
            &0,
        ),
        Err(Ok(RegistryError::InvalidThreshold))
    );
}

#[test]
fn cannot_finalize_while_round_is_open() {
    let f = setup();
    let id = create(&f);
    f.escrow.contribute(&id, &f.contributor, &500);
    assert_eq!(
        f.registry.try_finalize_funding(&id),
        Err(Ok(RegistryError::FundingOpen))
    );
}

#[test]
fn failed_round_enables_refunds() {
    let f = setup();
    let id = create(&f);
    f.escrow.contribute(&id, &f.contributor, &500);
    f.env.ledger().set_timestamp(1_000);
    assert!(!f.registry.finalize_funding(&id));
    assert_eq!(f.registry.get_grant(&id).status, GrantStatus::Failed);
    assert_eq!(f.escrow.claim_refund(&id, &f.contributor), 500);
}

#[test]
fn fully_funded_round_becomes_active() {
    let f = setup();
    let id = fund_and_activate(&f);
    assert_eq!(f.registry.get_grant(&id).status, GrantStatus::Active);
}

#[test]
fn weighted_vote_matches_contribution() {
    let f = setup();
    let id = fund_and_activate(&f);
    assert_eq!(f.registry.vote_milestone(&id, &f.contributor, &true), 1_000);
    let milestone = f.registry.get_milestones(&id).get(0).unwrap();
    assert_eq!(milestone.yes_weight, 1_000);
    assert!(f.registry.has_voted(&id, &0, &f.contributor));
}

#[test]
fn rejects_zero_power_and_duplicate_votes() {
    let f = setup();
    let id = fund_and_activate(&f);
    assert_eq!(
        f.registry.try_vote_milestone(&id, &f.outsider, &true),
        Err(Ok(RegistryError::NoVotingPower))
    );
    f.registry.vote_milestone(&id, &f.contributor, &true);
    assert_eq!(
        f.registry.try_vote_milestone(&id, &f.contributor, &false),
        Err(Ok(RegistryError::AlreadyVoted))
    );
}

#[test]
fn enforces_quorum() {
    let f = setup();
    let id = fund_and_activate(&f);
    assert_eq!(
        f.registry.try_finalize_milestone(&id),
        Err(Ok(RegistryError::QuorumNotMet))
    );
}

#[test]
fn enforces_approval_threshold() {
    let f = setup();
    let id = fund_and_activate(&f);
    f.registry.vote_milestone(&id, &f.contributor, &false);
    assert_eq!(
        f.registry.try_finalize_milestone(&id),
        Err(Ok(RegistryError::ApprovalNotMet))
    );
}

#[test]
fn approval_releases_exact_milestone() {
    let f = setup();
    let id = fund_and_activate(&f);
    f.registry.vote_milestone(&id, &f.contributor, &true);
    assert!(!f.registry.finalize_milestone(&id));
    assert_eq!(f.escrow.get_vault(&id).released, 400);
    assert_eq!(TokenClient::new(&f.env, &f.asset).balance(&f.creator), 400);
    assert_eq!(f.registry.get_grant(&id).current_milestone, 1);
}

#[test]
fn completing_all_milestones_closes_grant() {
    let f = setup();
    let id = fund_and_activate(&f);
    f.registry.vote_milestone(&id, &f.contributor, &true);
    f.registry.finalize_milestone(&id);
    f.registry.vote_milestone(&id, &f.contributor, &true);
    assert!(f.registry.finalize_milestone(&id));
    assert_eq!(f.registry.get_grant(&id).status, GrantStatus::Completed);
    assert_eq!(f.escrow.get_vault(&id).released, 1_000);
}

#[test]
fn creator_cancellation_enables_refunds() {
    let f = setup();
    let id = create(&f);
    f.escrow.contribute(&id, &f.contributor, &250);
    f.registry.cancel_grant(&id);
    assert_eq!(f.registry.get_grant(&id).status, GrantStatus::Cancelled);
    assert_eq!(f.escrow.claim_refund(&id, &f.contributor), 250);
}

#[test]
fn cannot_cancel_active_grant() {
    let f = setup();
    let id = fund_and_activate(&f);
    assert_eq!(
        f.registry.try_cancel_grant(&id),
        Err(Ok(RegistryError::InvalidState))
    );
}

#[test]
fn pause_blocks_registry_mutations() {
    let f = setup();
    f.registry.set_paused(&true);
    assert_eq!(
        f.registry.try_create_grant(
            &f.creator,
            &0,
            &String::from_str(&f.env, "Paused"),
            &f.asset,
            &1_000,
            &1_000,
            &schedule(&f.env),
            &6_000,
            &5_000,
        ),
        Err(Ok(RegistryError::Paused))
    );
}

#[test]
fn publishes_composed_lifecycle_events() {
    let f = setup();
    let id = fund_and_activate(&f);
    f.registry.vote_milestone(&id, &f.contributor, &true);
    f.registry.finalize_milestone(&id);
    // A composed finalization emits the SAC transfer, Escrow release, and
    // Registry approval in the same top-level invocation.
    assert_eq!(f.env.events().all().events().len(), 3);
}
