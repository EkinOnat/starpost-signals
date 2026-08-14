#![cfg(test)]

use super::*;
use impact_escrow_v1::{
    AssetPolicy as EscrowAssetPolicy, ImpactEscrowV1Contract, ImpactEscrowV1ContractClient,
};
use signals::{SignalsContract, SignalsContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Env, String, Vec,
};

struct Fixture {
    env: Env,
    registry: ImpactRegistryV1ContractClient<'static>,
    escrow: ImpactEscrowV1ContractClient<'static>,
    governor: Address,
    guardian: Address,
    creator: Address,
    payout: Address,
    alice: Address,
    bob: Address,
    outsider: Address,
    reviewers: Vec<Address>,
    arbitrators: Vec<Address>,
    asset: Address,
}

fn protocol_policy() -> ProtocolPolicy {
    ProtocolPolicy {
        reviewer_count: 3,
        reviewer_threshold: 2,
        arbitrator_count: 3,
        arbitrator_threshold: 2,
        min_contributors: 2,
        quorum_bps: 4_000,
        approval_bps: 6_000,
        dispute_bps: 2_500,
        max_contribution_bps: 5_000,
        max_vote_power_bps: 2_500,
        max_attempts: 2,
        max_funding_window: 10_000,
        activation_window: 100,
        review_start_grace: 10,
        review_window: 100,
        vote_start_grace: 10,
        voting_window: 100,
        arbitration_window: 100,
        rework_window: 100,
    }
}

fn registry_asset_policy() -> AssetPolicy {
    AssetPolicy {
        enabled_for_new_projects: true,
        decimals: 7,
        min_contribution: 1,
        max_goal: 1_000_000,
    }
}

fn escrow_asset_policy() -> EscrowAssetPolicy {
    EscrowAssetPolicy {
        enabled_for_new_vaults: true,
        decimals: 7,
        min_contribution: 1,
        max_goal: 1_000_000,
    }
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(100);
    let governor = Address::generate(&env);
    let guardian = Address::generate(&env);
    let creator = Address::generate(&env);
    let payout = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let outsider = Address::generate(&env);
    let reviewers = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let arbitrators = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let signals_id = env.register(SignalsContract, ());
    let registry_id = env.register(ImpactRegistryV1Contract, ());
    let escrow_id = env.register(ImpactEscrowV1Contract, ());
    let asset_contract = env.register_stellar_asset_contract_v2(governor.clone());
    let asset = asset_contract.address();
    StellarAssetClient::new(&env, &asset).mint(&alice, &10_000);
    StellarAssetClient::new(&env, &asset).mint(&bob, &10_000);

    SignalsContractClient::new(&env, &signals_id).initialize(
        &governor,
        &String::from_str(&env, "What should Stellar build next?"),
        &vec![
            &env,
            String::from_str(&env, "Payments"),
            String::from_str(&env, "Identity"),
            String::from_str(&env, "Climate"),
            String::from_str(&env, "Gaming"),
        ],
    );
    let escrow = ImpactEscrowV1ContractClient::new(&env, &escrow_id);
    escrow.initialize(
        &governor,
        &guardian,
        &registry_id,
        &asset,
        &escrow_asset_policy(),
    );
    let registry = ImpactRegistryV1ContractClient::new(&env, &registry_id);
    registry.initialize(
        &governor,
        &guardian,
        &signals_id,
        &escrow_id,
        &asset,
        &registry_asset_policy(),
        &protocol_policy(),
    );

    Fixture {
        env,
        registry,
        escrow,
        governor,
        guardian,
        creator,
        payout,
        alice,
        bob,
        outsider,
        reviewers,
        arbitrators,
        asset,
    }
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn milestone_inputs(env: &Env) -> Vec<MilestoneInput> {
    vec![
        env,
        MilestoneInput {
            metadata_sha256: hash(env, 11),
            amount: 400,
            delivery_window: 100,
        },
        MilestoneInput {
            metadata_sha256: hash(env, 12),
            amount: 600,
            delivery_window: 100,
        },
    ]
}

fn create_draft(f: &Fixture) -> u64 {
    f.registry.create_project(
        &f.creator,
        &ProjectInput {
            category: 0,
            metadata_sha256: hash(&f.env, 1),
            payout: f.payout.clone(),
            asset: f.asset.clone(),
            goal: 1_000,
            funding_deadline: 1_000,
        },
        &milestone_inputs(&f.env),
        &ReviewConfig {
            reviewers: f.reviewers.clone(),
            arbitrators: f.arbitrators.clone(),
        },
    )
}

fn accept_roles(f: &Fixture, project_id: u64) {
    for index in 0..f.reviewers.len() {
        f.registry
            .accept_reviewer(&f.reviewers.get(index).unwrap(), &project_id);
    }
    for index in 0..f.arbitrators.len() {
        f.registry
            .accept_arbitrator(&f.arbitrators.get(index).unwrap(), &project_id);
    }
}

fn fund_and_activate(f: &Fixture) -> u64 {
    let project_id = create_draft(f);
    accept_roles(f, project_id);
    f.registry.open_funding(&f.creator, &project_id);
    f.registry.contribute(&f.alice, &project_id, &500);
    f.registry.contribute(&f.bob, &project_id, &500);
    assert_eq!(
        f.registry.activate_project(&project_id),
        ProjectStatus::Active
    );
    project_id
}

fn verify_and_open_vote(f: &Fixture, project_id: u64, milestone: u32, byte: u8) {
    let evidence_hash = hash(&f.env, byte);
    let attempt = f
        .registry
        .get_milestones(&project_id)
        .get(milestone)
        .unwrap()
        .attempt;
    f.registry.submit_evidence(
        &f.creator,
        &project_id,
        &milestone,
        &EvidenceCommitment {
            content_sha256: evidence_hash.clone(),
            metadata_sha256: hash(&f.env, byte + 1),
            attempt,
        },
    );
    f.registry.open_review(&project_id, &milestone);
    f.registry.attest(
        &f.reviewers.get(0).unwrap(),
        &project_id,
        &milestone,
        &attempt,
        &evidence_hash,
        &ReviewerDecision::Verify,
    );
    assert_eq!(
        f.registry.attest(
            &f.reviewers.get(1).unwrap(),
            &project_id,
            &milestone,
            &attempt,
            &evidence_hash,
            &ReviewerDecision::Verify,
        ),
        MilestoneStatus::Verified
    );
    f.registry.open_voting(&project_id, &milestone);
}

fn approve_and_release(f: &Fixture, project_id: u64, milestone: u32, byte: u8) {
    let evidence_hash = hash(&f.env, byte);
    let state = f
        .registry
        .get_milestones(&project_id)
        .get(milestone)
        .unwrap();
    f.registry.vote(
        &f.alice,
        &project_id,
        &milestone,
        &state.attempt,
        &evidence_hash,
        &ContributorDecision::Approve,
    );
    f.env.ledger().set_timestamp(state.voting_deadline);
    assert_eq!(
        f.registry.finalize_vote(&project_id, &milestone),
        MilestoneStatus::Approved
    );
    f.registry.release_milestone(&project_id, &milestone);
}

#[test]
fn initialization_requires_real_authorization() {
    let env = Env::default();
    let governor = Address::generate(&env);
    let guardian = Address::generate(&env);
    let signals = Address::generate(&env);
    let escrow = Address::generate(&env);
    let asset = Address::generate(&env);
    let id = env.register(ImpactRegistryV1Contract, ());
    let client = ImpactRegistryV1ContractClient::new(&env, &id);
    assert!(client
        .try_initialize(
            &governor,
            &guardian,
            &signals,
            &escrow,
            &asset,
            &registry_asset_policy(),
            &protocol_policy(),
        )
        .is_err());
}

#[test]
fn draft_requires_independent_accepted_roles() {
    let f = setup();
    let project_id = create_draft(&f);
    assert_eq!(f.registry.version(), 1);
    assert_eq!(
        f.registry.try_open_funding(&f.creator, &project_id),
        Err(Ok(RegistryError::RoleNotAccepted))
    );
    accept_roles(&f, project_id);
    f.registry.open_funding(&f.creator, &project_id);
    assert_eq!(
        f.registry.get_project(&project_id).status,
        ProjectStatus::Funding
    );
}

#[test]
fn rejects_role_conflicts_and_creator_contributions() {
    let f = setup();
    let mut reviewers = f.reviewers.clone();
    reviewers.set(0, f.creator.clone());
    assert_eq!(
        f.registry.try_create_project(
            &f.creator,
            &ProjectInput {
                category: 0,
                metadata_sha256: hash(&f.env, 1),
                payout: f.payout.clone(),
                asset: f.asset.clone(),
                goal: 1_000,
                funding_deadline: 1_000,
            },
            &milestone_inputs(&f.env),
            &ReviewConfig {
                reviewers,
                arbitrators: f.arbitrators.clone(),
            },
        ),
        Err(Ok(RegistryError::RoleConflict))
    );
    let project_id = create_draft(&f);
    accept_roles(&f, project_id);
    f.registry.open_funding(&f.creator, &project_id);
    assert_eq!(
        f.registry.try_contribute(&f.creator, &project_id, &100),
        Err(Ok(RegistryError::RoleConflict))
    );
}

#[test]
fn complete_first_milestone_releases_exact_schedule() {
    let f = setup();
    let project_id = fund_and_activate(&f);
    verify_and_open_vote(&f, project_id, 0, 20);
    approve_and_release(&f, project_id, 0, 20);
    let project = f.registry.get_project(&project_id);
    assert_eq!(project.current_milestone, 1);
    assert_eq!(project.status, ProjectStatus::Active);
    assert_eq!(f.escrow.release_receipt(&project_id, &0), Some(400));
    assert_eq!(TokenClient::new(&f.env, &f.asset).balance(&f.payout), 400);
}

#[test]
fn contributor_dispute_rework_and_terminal_rejection_refund_remaining_funds() {
    let f = setup();
    let project_id = fund_and_activate(&f);
    verify_and_open_vote(&f, project_id, 0, 20);
    approve_and_release(&f, project_id, 0, 20);

    verify_and_open_vote(&f, project_id, 1, 30);
    let milestone = f.registry.get_milestones(&project_id).get(1).unwrap();
    f.registry.vote(
        &f.alice,
        &project_id,
        &1,
        &milestone.attempt,
        &hash(&f.env, 30),
        &ContributorDecision::Dispute,
    );
    assert_eq!(
        f.registry.get_project(&project_id).status,
        ProjectStatus::Disputed
    );
    for index in 0..2 {
        f.registry.arbitrate(
            &f.arbitrators.get(index).unwrap(),
            &project_id,
            &1,
            &milestone.attempt,
            &ArbitrationDecision::RequireRework,
        );
    }
    assert_eq!(
        f.registry.finalize_dispute(&project_id, &1),
        MilestoneStatus::Pending
    );
    let attempt = f
        .registry
        .get_milestones(&project_id)
        .get(1)
        .unwrap()
        .attempt;
    assert_eq!(attempt, 2);
    f.registry.submit_evidence(
        &f.creator,
        &project_id,
        &1,
        &EvidenceCommitment {
            content_sha256: hash(&f.env, 40),
            metadata_sha256: hash(&f.env, 41),
            attempt,
        },
    );
    f.registry.open_review(&project_id, &1);
    for index in 0..2 {
        f.registry.attest(
            &f.reviewers.get(index).unwrap(),
            &project_id,
            &1,
            &attempt,
            &hash(&f.env, 40),
            &ReviewerDecision::Reject,
        );
    }
    let rejected = f.registry.get_milestones(&project_id).get(1).unwrap();
    assert_eq!(rejected.status, MilestoneStatus::Rejected);
    assert_eq!(
        f.registry.try_start_rework(&f.creator, &project_id, &1),
        Err(Ok(RegistryError::AttemptsExhausted))
    );
    f.env.ledger().set_timestamp(rejected.rework_deadline);
    assert_eq!(f.registry.apply_timeout(&project_id), ProjectStatus::Failed);
    assert_eq!(f.escrow.claim_refund(&project_id, &f.alice), 300);
    assert_eq!(f.escrow.claim_refund(&project_id, &f.bob), 300);
    assert_eq!(f.escrow.get_vault(&project_id).remaining_pool, 0);
}

#[test]
fn failed_funding_refunds_exact_contribution() {
    let f = setup();
    let project_id = create_draft(&f);
    accept_roles(&f, project_id);
    f.registry.open_funding(&f.creator, &project_id);
    f.registry.contribute(&f.alice, &project_id, &400);
    f.env.ledger().set_timestamp(1_000);
    assert_eq!(
        f.registry.finalize_funding(&project_id),
        ProjectStatus::Failed
    );
    assert_eq!(f.escrow.claim_refund(&project_id, &f.alice), 400);
}

#[test]
fn pause_freezes_contract_deadline_clock() {
    let f = setup();
    let project_id = fund_and_activate(&f);
    let due = f
        .registry
        .get_milestones(&project_id)
        .get(0)
        .unwrap()
        .evidence_due_at;
    f.env.ledger().set_timestamp(150);
    f.registry
        .set_pause_mode(&f.guardian, &PauseMode::PauseRiskyMutations);
    f.env.ledger().set_timestamp(1_000);
    f.registry.set_pause_mode(&f.governor, &PauseMode::Running);
    f.env.ledger().set_timestamp(1_000 + (due - 150) - 1);
    assert_eq!(
        f.registry.try_apply_timeout(&project_id),
        Err(Ok(RegistryError::TimeoutNotReached))
    );
    f.env.ledger().set_timestamp(1_000 + (due - 150));
    assert_eq!(f.registry.apply_timeout(&project_id), ProjectStatus::Active);
    assert_eq!(
        f.registry
            .get_milestones(&project_id)
            .get(0)
            .unwrap()
            .status,
        MilestoneStatus::Rejected
    );
}

#[test]
fn projects_created_after_a_pause_keep_the_requested_wall_clock_window() {
    let f = setup();
    f.env.ledger().set_timestamp(150);
    f.registry
        .set_pause_mode(&f.guardian, &PauseMode::PauseRiskyMutations);
    f.env.ledger().set_timestamp(1_000);
    f.registry.set_pause_mode(&f.governor, &PauseMode::Running);
    let input = ProjectInput {
        category: 0,
        metadata_sha256: hash(&f.env, 1),
        payout: f.payout.clone(),
        asset: f.asset.clone(),
        goal: 1_000,
        funding_deadline: 1_100,
    };
    let project_id = f.registry.create_project(
        &f.creator,
        &input,
        &milestone_inputs(&f.env),
        &ReviewConfig {
            reviewers: f.reviewers.clone(),
            arbitrators: f.arbitrators.clone(),
        },
    );
    assert_eq!(f.registry.get_project(&project_id).funding_deadline, 250);
}

#[test]
fn governance_and_asset_policy_stay_atomic_across_registry_and_escrow() {
    let f = setup();
    let updated = AssetPolicy {
        enabled_for_new_projects: true,
        decimals: 7,
        min_contribution: 2,
        max_goal: 2_000_000,
    };
    f.registry.set_asset_policy(&f.asset, &updated);
    assert_eq!(f.registry.get_asset_policy(&f.asset), updated);
    assert_eq!(f.escrow.get_asset_policy(&f.asset).min_contribution, 2);

    let proposed = Address::generate(&f.env);
    f.registry.propose_governor(&proposed);
    assert_eq!(
        f.escrow.get_config().pending_governor,
        Some(proposed.clone())
    );
    f.registry.accept_governor();
    assert_eq!(f.registry.get_config().governor, proposed);
    assert_eq!(
        f.registry.get_config().governor,
        f.escrow.get_config().governor
    );
}

#[test]
fn outsider_cannot_review_or_arbitrate() {
    let f = setup();
    let project_id = fund_and_activate(&f);
    let commitment = EvidenceCommitment {
        content_sha256: hash(&f.env, 50),
        metadata_sha256: hash(&f.env, 51),
        attempt: 1,
    };
    f.registry
        .submit_evidence(&f.creator, &project_id, &0, &commitment);
    f.registry.open_review(&project_id, &0);
    assert_eq!(
        f.registry.try_attest(
            &f.outsider,
            &project_id,
            &0,
            &1,
            &hash(&f.env, 50),
            &ReviewerDecision::Verify,
        ),
        Err(Ok(RegistryError::Unauthorized))
    );
}
