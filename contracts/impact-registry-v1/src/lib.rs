#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    BytesN, Env, String, Vec,
};

const PROTOCOL_VERSION: u32 = 1;
const BPS_DENOMINATOR: i128 = 10_000;
const INSTANCE_TTL_THRESHOLD: u32 = 250_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 2_000_000;
const RECORD_TTL_THRESHOLD: u32 = 250_000;
const RECORD_TTL_EXTEND_TO: u32 = 2_000_000;
const MAX_TOUCH_ADDRESSES: u32 = 20;
const MIN_MILESTONES: u32 = 2;
const MAX_MILESTONES: u32 = 5;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PauseMode {
    Running,
    PauseNewActivity,
    PauseRiskyMutations,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectStatus {
    Draft,
    Funding,
    Funded,
    Active,
    Completed,
    Failed,
    Cancelled,
    Disputed,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    EvidenceSubmitted,
    UnderReview,
    Verified,
    Voting,
    Disputed,
    Approved,
    Rejected,
    Released,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Role {
    Reviewer,
    Arbitrator,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewerDecision {
    Verify,
    Reject,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ContributorDecision {
    Approve,
    Dispute,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArbitrationDecision {
    ApproveRelease,
    RejectMilestone,
    RequireRework,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignalsResults {
    pub question: String,
    pub options: Vec<String>,
    pub counts: Vec<u32>,
    pub total: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicy {
    pub enabled_for_new_projects: bool,
    pub decimals: u32,
    pub min_contribution: i128,
    pub max_goal: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolPolicy {
    pub reviewer_count: u32,
    pub reviewer_threshold: u32,
    pub arbitrator_count: u32,
    pub arbitrator_threshold: u32,
    pub min_contributors: u32,
    pub quorum_bps: u32,
    pub approval_bps: u32,
    pub dispute_bps: u32,
    pub max_contribution_bps: u32,
    pub max_vote_power_bps: u32,
    pub max_attempts: u32,
    pub max_funding_window: u64,
    pub activation_window: u64,
    pub review_start_grace: u64,
    pub review_window: u64,
    pub vote_start_grace: u64,
    pub voting_window: u64,
    pub arbitration_window: u64,
    pub rework_window: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryConfig {
    pub governor: Address,
    pub pause_guardian: Address,
    pub signals: Address,
    pub escrow: Address,
    pub pause_mode: PauseMode,
    pub pending_governor: Option<Address>,
    pub next_project_id: u64,
    pub total_paused_seconds: u64,
    pub pause_started_at: Option<u64>,
    pub standard_policy: ProtocolPolicy,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectInput {
    pub category: u32,
    pub metadata_sha256: BytesN<32>,
    pub payout: Address,
    pub asset: Address,
    pub goal: i128,
    pub funding_deadline: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneInput {
    pub metadata_sha256: BytesN<32>,
    pub amount: i128,
    pub delivery_window: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewConfig {
    pub reviewers: Vec<Address>,
    pub arbitrators: Vec<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceCommitment {
    pub content_sha256: BytesN<32>,
    pub metadata_sha256: BytesN<32>,
    pub attempt: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Project {
    pub id: u64,
    pub creator: Address,
    pub category: u32,
    pub metadata_sha256: BytesN<32>,
    pub payout: Address,
    pub asset: Address,
    pub goal: i128,
    pub funding_deadline: u64,
    pub status: ProjectStatus,
    pub current_milestone: u32,
    pub milestone_count: u32,
    pub contributor_count: u32,
    pub eligible_voting_power: i128,
    pub funded_at: u64,
    pub activation_deadline: u64,
    pub reviewers: Vec<Address>,
    pub arbitrators: Vec<Address>,
    pub policy: ProtocolPolicy,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub index: u32,
    pub metadata_sha256: BytesN<32>,
    pub amount: i128,
    pub delivery_window: u64,
    pub status: MilestoneStatus,
    pub attempt: u32,
    pub evidence_due_at: u64,
    pub stage_started_at: u64,
    pub review_deadline: u64,
    pub voting_deadline: u64,
    pub dispute_deadline: u64,
    pub rework_deadline: u64,
    pub verify_count: u32,
    pub reject_count: u32,
    pub approve_weight: i128,
    pub dispute_weight: i128,
    pub arbitration_approve: u32,
    pub arbitration_reject: u32,
    pub arbitration_rework: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    AssetPolicy(Address),
    Project(u64),
    Milestones(u64),
    RoleAccepted(u64, Role, Address),
    Evidence(u64, u32, u32),
    Attestation(u64, u32, u32, Address),
    ContributorVote(u64, u32, u32, Address),
    ArbitrationVote(u64, u32, u32, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    Unauthorized = 4,
    ProjectNotFound = 5,
    InvalidState = 6,
    InvalidCategory = 7,
    InvalidGoal = 8,
    InvalidDeadline = 9,
    InvalidMilestones = 10,
    UnsupportedAsset = 11,
    InvalidPolicy = 12,
    InvalidRoles = 13,
    RoleConflict = 14,
    RoleNotAccepted = 15,
    AlreadyAccepted = 16,
    FundingOpen = 17,
    ActivationPending = 18,
    NoVotingPower = 19,
    AlreadyVoted = 20,
    AlreadyAttested = 21,
    AlreadyArbitrated = 22,
    WrongEvidence = 23,
    AttemptsExhausted = 24,
    ReviewOpen = 25,
    VotingOpen = 26,
    DisputeOpen = 27,
    TimeoutNotReached = 28,
    ArithmeticOverflow = 29,
    InvalidPauseTransition = 30,
    TooManyTouchAddresses = 31,
}

#[contractclient(name = "SignalsClient")]
pub trait SignalsInterface {
    fn get_results(env: Env) -> SignalsResults;
}

#[contractclient(name = "EscrowClient")]
pub trait EscrowInterface {
    #[allow(clippy::too_many_arguments)]
    fn open_vault(
        env: Env,
        project_id: u64,
        payout: Address,
        asset: Address,
        goal: i128,
        funding_deadline: u64,
        milestone_amounts: Vec<i128>,
        max_contribution_bps: u32,
    );
    fn deposit(env: Env, project_id: u64, contributor: Address, amount: i128) -> i128;
    fn lock_funding(env: Env, project_id: u64);
    fn release_milestone(env: Env, project_id: u64, milestone: u32, amount: i128);
    fn enable_refunds(env: Env, project_id: u64) -> i128;
    fn total(env: Env, project_id: u64) -> i128;
    fn contribution(env: Env, project_id: u64, contributor: Address) -> i128;
    fn sync_asset_policy(
        env: Env,
        asset: Address,
        enabled_for_new_vaults: bool,
        decimals: u32,
        min_contribution: i128,
        max_goal: i128,
    );
    fn set_pause_mode(env: Env, actor: Address, mode: PauseMode);
    fn propose_governor(env: Env, proposed: Address);
    fn accept_governor(env: Env);
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectCreated {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    pub creator: Address,
    pub category: u32,
    pub asset: Address,
    pub goal: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectStateChanged {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    pub previous: ProjectStatus,
    pub current: ProjectStatus,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneStateChanged {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub attempt: u32,
    pub previous: MilestoneStatus,
    pub current: MilestoneStatus,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleAccepted {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub role: Role,
    pub actor: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceSubmitted {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub attempt: u32,
    pub content_sha256: BytesN<32>,
    pub metadata_sha256: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewerAttested {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub reviewer: Address,
    pub attempt: u32,
    pub content_sha256: BytesN<32>,
    pub decision: ReviewerDecision,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneVoteCast {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub contributor: Address,
    pub attempt: u32,
    pub content_sha256: BytesN<32>,
    pub decision: ContributorDecision,
    pub weight: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArbitrationVoteCast {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub arbitrator: Address,
    pub attempt: u32,
    pub decision: ArbitrationDecision,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutReleased {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub amount: i128,
    pub completed: bool,
}

#[contract]
pub struct ImpactRegistryV1Contract;

#[contractimpl]
impl ImpactRegistryV1Contract {
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        governor: Address,
        pause_guardian: Address,
        signals: Address,
        escrow: Address,
        initial_asset: Address,
        initial_asset_policy: AssetPolicy,
        standard_policy: ProtocolPolicy,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(RegistryError::AlreadyInitialized);
        }
        governor.require_auth();
        Self::validate_asset_policy(&initial_asset_policy)?;
        Self::validate_protocol_policy(&standard_policy)?;
        env.storage().instance().set(
            &DataKey::Config,
            &RegistryConfig {
                governor,
                pause_guardian,
                signals,
                escrow,
                pause_mode: PauseMode::Running,
                pending_governor: None,
                next_project_id: 1,
                total_paused_seconds: 0,
                pause_started_at: None,
                standard_policy,
            },
        );
        let asset_key = DataKey::AssetPolicy(initial_asset);
        env.storage()
            .persistent()
            .set(&asset_key, &initial_asset_policy);
        Self::bump_record_ttl(&env, &asset_key);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn version(_env: Env) -> u32 {
        PROTOCOL_VERSION
    }

    pub fn create_project(
        env: Env,
        creator: Address,
        input: ProjectInput,
        milestone_inputs: Vec<MilestoneInput>,
        review_config: ReviewConfig,
    ) -> Result<u64, RegistryError> {
        let mut config = Self::config(&env)?;
        Self::require_new_activity(&config)?;
        creator.require_auth();
        let raw_now = env.ledger().timestamp();
        let now = Self::effective_now(&env, &config)?;
        Self::validate_project_input(&env, &config, &creator, &input, &milestone_inputs, raw_now)?;
        Self::validate_roles(
            &creator,
            &input.payout,
            &review_config,
            &config.standard_policy,
        )?;

        let signals = SignalsClient::new(&env, &config.signals).get_results();
        if input.category >= signals.options.len() {
            return Err(RegistryError::InvalidCategory);
        }

        let project_id = config.next_project_id;
        config.next_project_id = config
            .next_project_id
            .checked_add(1)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let mut milestones: Vec<Milestone> = Vec::new(&env);
        for index in 0..milestone_inputs.len() {
            let item = milestone_inputs
                .get(index)
                .ok_or(RegistryError::InvalidMilestones)?;
            milestones.push_back(Milestone {
                index,
                metadata_sha256: item.metadata_sha256,
                amount: item.amount,
                delivery_window: item.delivery_window,
                status: MilestoneStatus::Pending,
                attempt: 1,
                evidence_due_at: 0,
                stage_started_at: now,
                review_deadline: 0,
                voting_deadline: 0,
                dispute_deadline: 0,
                rework_deadline: 0,
                verify_count: 0,
                reject_count: 0,
                approve_weight: 0,
                dispute_weight: 0,
                arbitration_approve: 0,
                arbitration_reject: 0,
                arbitration_rework: 0,
            });
        }
        let funding_duration = input
            .funding_deadline
            .checked_sub(raw_now)
            .ok_or(RegistryError::InvalidDeadline)?;
        let effective_funding_deadline = now
            .checked_add(funding_duration)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let project = Project {
            id: project_id,
            creator: creator.clone(),
            category: input.category,
            metadata_sha256: input.metadata_sha256,
            payout: input.payout,
            asset: input.asset.clone(),
            goal: input.goal,
            funding_deadline: effective_funding_deadline,
            status: ProjectStatus::Draft,
            current_milestone: 0,
            milestone_count: milestones.len(),
            contributor_count: 0,
            eligible_voting_power: 0,
            funded_at: 0,
            activation_deadline: 0,
            reviewers: review_config.reviewers,
            arbitrators: review_config.arbitrators,
            policy: config.standard_policy.clone(),
        };
        let project_key = DataKey::Project(project_id);
        let milestones_key = DataKey::Milestones(project_id);
        env.storage().persistent().set(&project_key, &project);
        env.storage().persistent().set(&milestones_key, &milestones);
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        ProjectCreated {
            schema_version: PROTOCOL_VERSION,
            project_id,
            creator,
            category: project.category,
            asset: input.asset,
            goal: project.goal,
        }
        .publish(&env);
        Ok(project_id)
    }

    pub fn update_draft(
        env: Env,
        creator: Address,
        project_id: u64,
        metadata_sha256: BytesN<32>,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_new_activity(&config)?;
        creator.require_auth();
        let key = DataKey::Project(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Draft || project.creator != creator {
            return Err(RegistryError::InvalidState);
        }
        project.metadata_sha256 = metadata_sha256;
        env.storage().persistent().set(&key, &project);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn accept_reviewer(
        env: Env,
        reviewer: Address,
        project_id: u64,
    ) -> Result<(), RegistryError> {
        Self::accept_role(&env, reviewer, project_id, Role::Reviewer)
    }

    pub fn accept_arbitrator(
        env: Env,
        arbitrator: Address,
        project_id: u64,
    ) -> Result<(), RegistryError> {
        Self::accept_role(&env, arbitrator, project_id, Role::Arbitrator)
    }

    pub fn open_funding(env: Env, creator: Address, project_id: u64) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_new_activity(&config)?;
        creator.require_auth();
        let project_key = DataKey::Project(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Draft || project.creator != creator {
            return Err(RegistryError::InvalidState);
        }
        if !Self::all_roles_accepted(&env, &project) {
            return Err(RegistryError::RoleNotAccepted);
        }
        let milestones = Self::milestones(&env, project_id)?;
        let mut amounts: Vec<i128> = Vec::new(&env);
        for index in 0..milestones.len() {
            amounts.push_back(
                milestones
                    .get(index)
                    .ok_or(RegistryError::InvalidMilestones)?
                    .amount,
            );
        }
        EscrowClient::new(&env, &config.escrow).open_vault(
            &project_id,
            &project.payout,
            &project.asset,
            &project.goal,
            &project.funding_deadline,
            &amounts,
            &project.policy.max_contribution_bps,
        );
        let previous = project.status;
        project.status = ProjectStatus::Funding;
        env.storage().persistent().set(&project_key, &project);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_instance_ttl(&env);
        Self::publish_project_state(&env, project_id, previous, project.status);
        Ok(())
    }

    pub fn contribute(
        env: Env,
        contributor: Address,
        project_id: u64,
        amount: i128,
    ) -> Result<i128, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_new_activity(&config)?;
        contributor.require_auth();
        if amount <= 0 {
            return Err(RegistryError::InvalidGoal);
        }
        let now = Self::effective_now(&env, &config)?;
        let project_key = DataKey::Project(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Funding || now >= project.funding_deadline {
            return Err(RegistryError::InvalidState);
        }
        if Self::has_project_role(&project, &contributor)
            || contributor == project.creator
            || contributor == project.payout
        {
            return Err(RegistryError::RoleConflict);
        }
        let escrow = EscrowClient::new(&env, &config.escrow);
        let previous_contribution = escrow.contribution(&project_id, &contributor);
        let contributor_total = escrow.deposit(&project_id, &contributor, &amount);
        let previous_power = Self::voting_power(&project, previous_contribution)?;
        let current_power = Self::voting_power(&project, contributor_total)?;
        project.eligible_voting_power = project
            .eligible_voting_power
            .checked_add(
                current_power
                    .checked_sub(previous_power)
                    .ok_or(RegistryError::ArithmeticOverflow)?,
            )
            .ok_or(RegistryError::ArithmeticOverflow)?;
        if previous_contribution == 0 {
            project.contributor_count = project
                .contributor_count
                .checked_add(1)
                .ok_or(RegistryError::ArithmeticOverflow)?;
        }
        if escrow.total(&project_id) == project.goal {
            escrow.lock_funding(&project_id);
            let previous = project.status;
            project.status = ProjectStatus::Funded;
            project.funded_at = now;
            project.activation_deadline = now
                .checked_add(project.policy.activation_window)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            Self::publish_project_state(&env, project_id, previous, project.status);
        }
        env.storage().persistent().set(&project_key, &project);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_instance_ttl(&env);
        Ok(contributor_total)
    }

    pub fn finalize_funding(env: Env, project_id: u64) -> Result<ProjectStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let key = DataKey::Project(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Funding {
            return Err(RegistryError::InvalidState);
        }
        let escrow = EscrowClient::new(&env, &config.escrow);
        let total = escrow.total(&project_id);
        if total == project.goal {
            escrow.lock_funding(&project_id);
            let previous = project.status;
            project.status = ProjectStatus::Funded;
            project.funded_at = now;
            project.activation_deadline = now
                .checked_add(project.policy.activation_window)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            Self::publish_project_state(&env, project_id, previous, project.status);
        } else if now >= project.funding_deadline {
            escrow.enable_refunds(&project_id);
            let previous = project.status;
            project.status = ProjectStatus::Failed;
            Self::publish_project_state(&env, project_id, previous, project.status);
        } else {
            return Err(RegistryError::FundingOpen);
        }
        env.storage().persistent().set(&key, &project);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Ok(project.status)
    }

    pub fn activate_project(env: Env, project_id: u64) -> Result<ProjectStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project_key = DataKey::Project(project_id);
        let milestones_key = DataKey::Milestones(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Funded {
            return Err(RegistryError::InvalidState);
        }
        if project.contributor_count < project.policy.min_contributors {
            if now < project.activation_deadline {
                return Err(RegistryError::ActivationPending);
            }
            EscrowClient::new(&env, &config.escrow).enable_refunds(&project_id);
            let previous = project.status;
            project.status = ProjectStatus::Cancelled;
            env.storage().persistent().set(&project_key, &project);
            Self::bump_record_ttl(&env, &project_key);
            Self::bump_instance_ttl(&env);
            Self::publish_project_state(&env, project_id, previous, project.status);
            return Ok(project.status);
        }
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut current = milestones.get(0).ok_or(RegistryError::InvalidMilestones)?;
        current.evidence_due_at = now
            .checked_add(current.delivery_window)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        current.stage_started_at = now;
        milestones.set(0, current);
        let previous = project.status;
        project.status = ProjectStatus::Active;
        env.storage().persistent().set(&project_key, &project);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        Self::publish_project_state(&env, project_id, previous, project.status);
        Ok(project.status)
    }

    pub fn submit_evidence(
        env: Env,
        creator: Address,
        project_id: u64,
        milestone_index: u32,
        commitment: EvidenceCommitment,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        creator.require_auth();
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Active
            || project.creator != creator
            || project.current_milestone != milestone_index
        {
            return Err(RegistryError::InvalidState);
        }
        let milestones_key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::Pending
            || commitment.attempt != milestone.attempt
            || now >= milestone.evidence_due_at
        {
            return Err(RegistryError::InvalidState);
        }
        let evidence_key = DataKey::Evidence(project_id, milestone_index, commitment.attempt);
        if env.storage().persistent().has(&evidence_key) {
            return Err(RegistryError::WrongEvidence);
        }
        let previous = milestone.status;
        milestone.status = MilestoneStatus::EvidenceSubmitted;
        milestone.stage_started_at = now;
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&evidence_key, &commitment);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &evidence_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        EvidenceSubmitted {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone: milestone_index,
            attempt: commitment.attempt,
            content_sha256: commitment.content_sha256,
            metadata_sha256: commitment.metadata_sha256,
        }
        .publish(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous,
            milestone.status,
        );
        Ok(())
    }

    pub fn open_review(
        env: Env,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Active || project.current_milestone != milestone_index {
            return Err(RegistryError::InvalidState);
        }
        let key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::EvidenceSubmitted {
            return Err(RegistryError::InvalidState);
        }
        let previous = milestone.status;
        milestone.status = MilestoneStatus::UnderReview;
        milestone.stage_started_at = now;
        milestone.review_deadline = now
            .checked_add(project.policy.review_window)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&key, &milestones);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous,
            milestone.status,
        );
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn attest(
        env: Env,
        reviewer: Address,
        project_id: u64,
        milestone_index: u32,
        attempt: u32,
        evidence_hash: BytesN<32>,
        decision: ReviewerDecision,
    ) -> Result<MilestoneStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        reviewer.require_auth();
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Active
            || project.current_milestone != milestone_index
            || !Self::contains_address(&project.reviewers, &reviewer)
            || !Self::role_is_accepted(&env, project_id, Role::Reviewer, &reviewer)
        {
            return Err(RegistryError::Unauthorized);
        }
        let milestones_key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::UnderReview
            || milestone.attempt != attempt
            || now >= milestone.review_deadline
        {
            return Err(RegistryError::InvalidState);
        }
        let evidence = Self::evidence(&env, project_id, milestone_index, attempt)?;
        if evidence.content_sha256 != evidence_hash {
            return Err(RegistryError::WrongEvidence);
        }
        let receipt_key =
            DataKey::Attestation(project_id, milestone_index, attempt, reviewer.clone());
        if env.storage().persistent().has(&receipt_key) {
            return Err(RegistryError::AlreadyAttested);
        }
        match decision {
            ReviewerDecision::Verify => {
                milestone.verify_count = milestone
                    .verify_count
                    .checked_add(1)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
            ReviewerDecision::Reject => {
                milestone.reject_count = milestone
                    .reject_count
                    .checked_add(1)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
        }
        let previous = milestone.status;
        if milestone.verify_count >= project.policy.reviewer_threshold {
            milestone.status = MilestoneStatus::Verified;
            milestone.stage_started_at = now;
        } else if milestone.reject_count >= project.policy.reviewer_threshold {
            Self::mark_rejected(&mut milestone, &project.policy, now)?;
        }
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&receipt_key, &decision);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &receipt_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        ReviewerAttested {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone: milestone_index,
            reviewer,
            attempt,
            content_sha256: evidence_hash,
            decision,
        }
        .publish(&env);
        if milestone.status != previous {
            Self::publish_milestone_state(
                &env,
                project_id,
                milestone_index,
                attempt,
                previous,
                milestone.status,
            );
        }
        Ok(milestone.status)
    }

    pub fn finalize_review(
        env: Env,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<MilestoneStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        let key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if project.status != ProjectStatus::Active
            || milestone.status != MilestoneStatus::UnderReview
        {
            return Err(RegistryError::InvalidState);
        }
        if now < milestone.review_deadline {
            return Err(RegistryError::ReviewOpen);
        }
        let previous = milestone.status;
        Self::mark_rejected(&mut milestone, &project.policy, now)?;
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&key, &milestones);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous,
            milestone.status,
        );
        Ok(milestone.status)
    }

    pub fn open_voting(
        env: Env,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Active || project.current_milestone != milestone_index {
            return Err(RegistryError::InvalidState);
        }
        let key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::Verified {
            return Err(RegistryError::InvalidState);
        }
        let previous = milestone.status;
        milestone.status = MilestoneStatus::Voting;
        milestone.stage_started_at = now;
        milestone.voting_deadline = now
            .checked_add(project.policy.voting_window)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&key, &milestones);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous,
            milestone.status,
        );
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn vote(
        env: Env,
        contributor: Address,
        project_id: u64,
        milestone_index: u32,
        attempt: u32,
        evidence_hash: BytesN<32>,
        decision: ContributorDecision,
    ) -> Result<i128, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        contributor.require_auth();
        let now = Self::effective_now(&env, &config)?;
        let project_key = DataKey::Project(project_id);
        let milestones_key = DataKey::Milestones(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Active
            || project.current_milestone != milestone_index
            || Self::has_project_role(&project, &contributor)
            || contributor == project.creator
            || contributor == project.payout
        {
            return Err(RegistryError::InvalidState);
        }
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::Voting
            || milestone.attempt != attempt
            || now >= milestone.voting_deadline
        {
            return Err(RegistryError::InvalidState);
        }
        let evidence = Self::evidence(&env, project_id, milestone_index, attempt)?;
        if evidence.content_sha256 != evidence_hash {
            return Err(RegistryError::WrongEvidence);
        }
        let vote_key =
            DataKey::ContributorVote(project_id, milestone_index, attempt, contributor.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(RegistryError::AlreadyVoted);
        }
        let contribution =
            EscrowClient::new(&env, &config.escrow).contribution(&project_id, &contributor);
        let weight = Self::voting_power(&project, contribution)?;
        if weight <= 0 {
            return Err(RegistryError::NoVotingPower);
        }
        match decision {
            ContributorDecision::Approve => {
                milestone.approve_weight = milestone
                    .approve_weight
                    .checked_add(weight)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
            ContributorDecision::Dispute => {
                milestone.dispute_weight = milestone
                    .dispute_weight
                    .checked_add(weight)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
        }
        env.storage().persistent().set(&vote_key, &decision);
        let dispute_reached = Self::ratio_reached(
            milestone.dispute_weight,
            project.eligible_voting_power,
            project.policy.dispute_bps,
        )?;
        if dispute_reached {
            let previous_milestone = milestone.status;
            let previous_project = project.status;
            milestone.status = MilestoneStatus::Disputed;
            milestone.stage_started_at = now;
            milestone.dispute_deadline = now
                .checked_add(project.policy.arbitration_window)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            project.status = ProjectStatus::Disputed;
            Self::publish_milestone_state(
                &env,
                project_id,
                milestone_index,
                attempt,
                previous_milestone,
                milestone.status,
            );
            Self::publish_project_state(&env, project_id, previous_project, project.status);
        }
        milestones.set(milestone_index, milestone);
        env.storage().persistent().set(&project_key, &project);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &vote_key);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        MilestoneVoteCast {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone: milestone_index,
            contributor,
            attempt,
            content_sha256: evidence_hash,
            decision,
            weight,
        }
        .publish(&env);
        Ok(weight)
    }

    pub fn finalize_vote(
        env: Env,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<MilestoneStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        let key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if project.status != ProjectStatus::Active || milestone.status != MilestoneStatus::Voting {
            return Err(RegistryError::InvalidState);
        }
        if now < milestone.voting_deadline {
            return Err(RegistryError::VotingOpen);
        }
        let participation = milestone
            .approve_weight
            .checked_add(milestone.dispute_weight)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let quorum = Self::ratio_reached(
            participation,
            project.eligible_voting_power,
            project.policy.quorum_bps,
        )?;
        let approval = Self::ratio_reached(
            milestone.approve_weight,
            participation,
            project.policy.approval_bps,
        )?;
        let previous = milestone.status;
        if quorum && approval {
            milestone.status = MilestoneStatus::Approved;
            milestone.stage_started_at = now;
        } else {
            Self::mark_rejected(&mut milestone, &project.policy, now)?;
        }
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&key, &milestones);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous,
            milestone.status,
        );
        Ok(milestone.status)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn arbitrate(
        env: Env,
        arbitrator: Address,
        project_id: u64,
        milestone_index: u32,
        attempt: u32,
        decision: ArbitrationDecision,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        arbitrator.require_auth();
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Disputed
            || !Self::contains_address(&project.arbitrators, &arbitrator)
            || !Self::role_is_accepted(&env, project_id, Role::Arbitrator, &arbitrator)
        {
            return Err(RegistryError::Unauthorized);
        }
        let key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::Disputed
            || milestone.attempt != attempt
            || now >= milestone.dispute_deadline
        {
            return Err(RegistryError::InvalidState);
        }
        let receipt_key =
            DataKey::ArbitrationVote(project_id, milestone_index, attempt, arbitrator.clone());
        if env.storage().persistent().has(&receipt_key) {
            return Err(RegistryError::AlreadyArbitrated);
        }
        match decision {
            ArbitrationDecision::ApproveRelease => {
                milestone.arbitration_approve = milestone
                    .arbitration_approve
                    .checked_add(1)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
            ArbitrationDecision::RejectMilestone => {
                milestone.arbitration_reject = milestone
                    .arbitration_reject
                    .checked_add(1)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
            ArbitrationDecision::RequireRework => {
                milestone.arbitration_rework = milestone
                    .arbitration_rework
                    .checked_add(1)
                    .ok_or(RegistryError::ArithmeticOverflow)?;
            }
        }
        milestones.set(milestone_index, milestone);
        env.storage().persistent().set(&key, &milestones);
        env.storage().persistent().set(&receipt_key, &decision);
        Self::bump_record_ttl(&env, &key);
        Self::bump_record_ttl(&env, &receipt_key);
        Self::bump_instance_ttl(&env);
        ArbitrationVoteCast {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone: milestone_index,
            arbitrator,
            attempt,
            decision,
        }
        .publish(&env);
        Ok(())
    }

    pub fn finalize_dispute(
        env: Env,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<MilestoneStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project_key = DataKey::Project(project_id);
        let milestones_key = DataKey::Milestones(project_id);
        let mut project = Self::project(&env, project_id)?;
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if project.status != ProjectStatus::Disputed
            || milestone.status != MilestoneStatus::Disputed
        {
            return Err(RegistryError::InvalidState);
        }
        let threshold = project.policy.arbitrator_threshold;
        let previous_project = project.status;
        let previous_milestone = milestone.status;
        if milestone.arbitration_approve >= threshold {
            milestone.status = MilestoneStatus::Approved;
            milestone.stage_started_at = now;
            project.status = ProjectStatus::Active;
        } else if milestone.arbitration_rework >= threshold {
            Self::reset_for_rework(&mut milestone, &project.policy, now)?;
            project.status = ProjectStatus::Active;
        } else if milestone.arbitration_reject >= threshold || now >= milestone.dispute_deadline {
            milestone.status = MilestoneStatus::Rejected;
            milestone.stage_started_at = now;
            project.status = ProjectStatus::Failed;
            EscrowClient::new(&env, &config.escrow).enable_refunds(&project_id);
        } else {
            return Err(RegistryError::DisputeOpen);
        }
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&project_key, &project);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous_milestone,
            milestone.status,
        );
        Self::publish_project_state(&env, project_id, previous_project, project.status);
        Ok(milestone.status)
    }

    pub fn start_rework(
        env: Env,
        creator: Address,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        creator.require_auth();
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        if project.status != ProjectStatus::Active || project.creator != creator {
            return Err(RegistryError::InvalidState);
        }
        let key = DataKey::Milestones(project_id);
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if milestone.status != MilestoneStatus::Rejected || now >= milestone.rework_deadline {
            return Err(RegistryError::InvalidState);
        }
        let previous = milestone.status;
        Self::reset_for_rework(&mut milestone, &project.policy, now)?;
        milestones.set(milestone_index, milestone.clone());
        env.storage().persistent().set(&key, &milestones);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous,
            milestone.status,
        );
        Ok(())
    }

    pub fn release_milestone(
        env: Env,
        project_id: u64,
        milestone_index: u32,
    ) -> Result<bool, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project_key = DataKey::Project(project_id);
        let milestones_key = DataKey::Milestones(project_id);
        let mut project = Self::project(&env, project_id)?;
        let mut milestones = Self::milestones(&env, project_id)?;
        let mut milestone = milestones
            .get(milestone_index)
            .ok_or(RegistryError::InvalidMilestones)?;
        if project.status != ProjectStatus::Active
            || project.current_milestone != milestone_index
            || milestone.status != MilestoneStatus::Approved
        {
            return Err(RegistryError::InvalidState);
        }
        EscrowClient::new(&env, &config.escrow).release_milestone(
            &project_id,
            &milestone_index,
            &milestone.amount,
        );
        let previous_milestone = milestone.status;
        milestone.status = MilestoneStatus::Released;
        milestone.stage_started_at = now;
        milestones.set(milestone_index, milestone.clone());
        let completed = milestone_index + 1 == project.milestone_count;
        let previous_project = project.status;
        if completed {
            project.status = ProjectStatus::Completed;
        } else {
            project.current_milestone = project
                .current_milestone
                .checked_add(1)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            let mut next = milestones
                .get(project.current_milestone)
                .ok_or(RegistryError::InvalidMilestones)?;
            next.evidence_due_at = now
                .checked_add(next.delivery_window)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            next.stage_started_at = now;
            milestones.set(project.current_milestone, next);
        }
        env.storage().persistent().set(&project_key, &project);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &project_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        Self::publish_milestone_state(
            &env,
            project_id,
            milestone_index,
            milestone.attempt,
            previous_milestone,
            milestone.status,
        );
        if project.status != previous_project {
            Self::publish_project_state(&env, project_id, previous_project, project.status);
        }
        PayoutReleased {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone: milestone_index,
            amount: milestone.amount,
            completed,
        }
        .publish(&env);
        Ok(completed)
    }

    pub fn cancel_project(
        env: Env,
        creator: Address,
        project_id: u64,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        creator.require_auth();
        let key = DataKey::Project(project_id);
        let mut project = Self::project(&env, project_id)?;
        if project.creator != creator
            || (project.status != ProjectStatus::Draft && project.status != ProjectStatus::Funding)
        {
            return Err(RegistryError::InvalidState);
        }
        let previous = project.status;
        if project.status == ProjectStatus::Funding {
            EscrowClient::new(&env, &config.escrow).enable_refunds(&project_id);
        }
        project.status = ProjectStatus::Cancelled;
        env.storage().persistent().set(&key, &project);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Self::publish_project_state(&env, project_id, previous, project.status);
        Ok(())
    }

    pub fn apply_timeout(env: Env, project_id: u64) -> Result<ProjectStatus, RegistryError> {
        let config = Self::config(&env)?;
        Self::require_risky_mutation(&config)?;
        let now = Self::effective_now(&env, &config)?;
        let project = Self::project(&env, project_id)?;
        match project.status {
            ProjectStatus::Funding => Self::finalize_funding(env, project_id),
            ProjectStatus::Funded => Self::activate_project(env, project_id),
            ProjectStatus::Disputed => {
                let milestone_index = project.current_milestone;
                let milestone = Self::milestones(&env, project_id)?
                    .get(milestone_index)
                    .ok_or(RegistryError::InvalidMilestones)?;
                if now < milestone.dispute_deadline {
                    return Err(RegistryError::TimeoutNotReached);
                }
                Self::finalize_dispute(env.clone(), project_id, milestone_index)?;
                Ok(Self::project(&env, project_id)?.status)
            }
            ProjectStatus::Active => {
                let milestone_index = project.current_milestone;
                let milestone = Self::milestones(&env, project_id)?
                    .get(milestone_index)
                    .ok_or(RegistryError::InvalidMilestones)?;
                match milestone.status {
                    MilestoneStatus::Pending if now >= milestone.evidence_due_at => {
                        Self::timeout_to_rejected(&env, &config, project, milestone, now)
                    }
                    MilestoneStatus::EvidenceSubmitted
                        if now
                            >= milestone
                                .stage_started_at
                                .checked_add(project.policy.review_start_grace)
                                .ok_or(RegistryError::ArithmeticOverflow)? =>
                    {
                        Self::open_review(env.clone(), project_id, milestone_index)?;
                        Ok(ProjectStatus::Active)
                    }
                    MilestoneStatus::UnderReview if now >= milestone.review_deadline => {
                        Self::finalize_review(env.clone(), project_id, milestone_index)?;
                        Ok(ProjectStatus::Active)
                    }
                    MilestoneStatus::Verified
                        if now
                            >= milestone
                                .stage_started_at
                                .checked_add(project.policy.vote_start_grace)
                                .ok_or(RegistryError::ArithmeticOverflow)? =>
                    {
                        Self::open_voting(env.clone(), project_id, milestone_index)?;
                        Ok(ProjectStatus::Active)
                    }
                    MilestoneStatus::Voting if now >= milestone.voting_deadline => {
                        Self::finalize_vote(env.clone(), project_id, milestone_index)?;
                        Ok(ProjectStatus::Active)
                    }
                    MilestoneStatus::Rejected if now >= milestone.rework_deadline => {
                        Self::fail_project(&env, &config, project_id)
                    }
                    _ => Err(RegistryError::TimeoutNotReached),
                }
            }
            _ => Err(RegistryError::InvalidState),
        }
    }

    pub fn set_asset_policy(
        env: Env,
        asset: Address,
        policy: AssetPolicy,
    ) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        config.governor.require_auth();
        Self::validate_asset_policy(&policy)?;
        EscrowClient::new(&env, &config.escrow).sync_asset_policy(
            &asset,
            &policy.enabled_for_new_projects,
            &policy.decimals,
            &policy.min_contribution,
            &policy.max_goal,
        );
        let key = DataKey::AssetPolicy(asset);
        env.storage().persistent().set(&key, &policy);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn set_pause_mode(env: Env, actor: Address, mode: PauseMode) -> Result<(), RegistryError> {
        let mut config = Self::config(&env)?;
        if actor == config.governor {
            actor.require_auth();
        } else if actor == config.pause_guardian {
            actor.require_auth();
            if Self::pause_rank(mode) < Self::pause_rank(config.pause_mode) {
                return Err(RegistryError::InvalidPauseTransition);
            }
        } else {
            return Err(RegistryError::Unauthorized);
        }
        EscrowClient::new(&env, &config.escrow).set_pause_mode(&actor, &mode);
        let was_running = config.pause_mode == PauseMode::Running;
        let will_run = mode == PauseMode::Running;
        if was_running && !will_run {
            config.pause_started_at = Some(env.ledger().timestamp());
        } else if !was_running && will_run {
            let started = config
                .pause_started_at
                .ok_or(RegistryError::InvalidPauseTransition)?;
            let duration = env
                .ledger()
                .timestamp()
                .checked_sub(started)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            config.total_paused_seconds = config
                .total_paused_seconds
                .checked_add(duration)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            config.pause_started_at = None;
        }
        config.pause_mode = mode;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn propose_governor(env: Env, proposed: Address) -> Result<(), RegistryError> {
        let mut config = Self::config(&env)?;
        config.governor.require_auth();
        EscrowClient::new(&env, &config.escrow).propose_governor(&proposed);
        config.pending_governor = Some(proposed);
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn accept_governor(env: Env) -> Result<(), RegistryError> {
        let mut config = Self::config(&env)?;
        let proposed = config
            .pending_governor
            .clone()
            .ok_or(RegistryError::Unauthorized)?;
        proposed.require_auth();
        EscrowClient::new(&env, &config.escrow).accept_governor();
        config.governor = proposed;
        config.pending_governor = None;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<RegistryConfig, RegistryError> {
        Self::bump_instance_ttl(&env);
        Self::config(&env)
    }

    pub fn get_project(env: Env, project_id: u64) -> Result<Project, RegistryError> {
        let project = Self::project(&env, project_id)?;
        Self::bump_record_ttl(&env, &DataKey::Project(project_id));
        Ok(project)
    }

    pub fn project_count(env: Env) -> Result<u64, RegistryError> {
        let config = Self::config(&env)?;
        Self::bump_instance_ttl(&env);
        config
            .next_project_id
            .checked_sub(1)
            .ok_or(RegistryError::ArithmeticOverflow)
    }

    pub fn get_asset_policy(env: Env, asset: Address) -> Result<AssetPolicy, RegistryError> {
        let policy = Self::asset_policy_internal(&env, &asset)?;
        Self::bump_record_ttl(&env, &DataKey::AssetPolicy(asset));
        Ok(policy)
    }

    pub fn get_milestones(env: Env, project_id: u64) -> Result<Vec<Milestone>, RegistryError> {
        let milestones = Self::milestones(&env, project_id)?;
        Self::bump_record_ttl(&env, &DataKey::Milestones(project_id));
        Ok(milestones)
    }

    pub fn get_evidence(
        env: Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
    ) -> Result<EvidenceCommitment, RegistryError> {
        let evidence = Self::evidence(&env, project_id, milestone, attempt)?;
        Self::bump_record_ttl(&env, &DataKey::Evidence(project_id, milestone, attempt));
        Ok(evidence)
    }

    pub fn role_accepted(env: Env, project_id: u64, role: Role, actor: Address) -> bool {
        Self::role_is_accepted(&env, project_id, role, &actor)
    }

    pub fn has_voted(
        env: Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
        contributor: Address,
    ) -> bool {
        let key = DataKey::ContributorVote(project_id, milestone, attempt, contributor);
        let exists = env.storage().persistent().has(&key);
        if exists {
            Self::bump_record_ttl(&env, &key);
        }
        exists
    }

    pub fn get_attestation(
        env: Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
        reviewer: Address,
    ) -> Option<ReviewerDecision> {
        let key = DataKey::Attestation(project_id, milestone, attempt, reviewer);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_record_ttl(&env, &key);
        }
        value
    }

    pub fn get_vote(
        env: Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
        contributor: Address,
    ) -> Option<ContributorDecision> {
        let key = DataKey::ContributorVote(project_id, milestone, attempt, contributor);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_record_ttl(&env, &key);
        }
        value
    }

    pub fn get_arbitration_vote(
        env: Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
        arbitrator: Address,
    ) -> Option<ArbitrationDecision> {
        let key = DataKey::ArbitrationVote(project_id, milestone, attempt, arbitrator);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            Self::bump_record_ttl(&env, &key);
        }
        value
    }

    pub fn touch_project(
        env: Env,
        project_id: u64,
        actors: Vec<Address>,
    ) -> Result<(), RegistryError> {
        if actors.len() > MAX_TOUCH_ADDRESSES {
            return Err(RegistryError::TooManyTouchAddresses);
        }
        let project = Self::project(&env, project_id)?;
        Self::bump_record_ttl(&env, &DataKey::Project(project_id));
        Self::bump_record_ttl(&env, &DataKey::Milestones(project_id));
        for index in 0..project.milestone_count {
            for attempt in 1..=project.policy.max_attempts {
                let evidence_key = DataKey::Evidence(project_id, index, attempt);
                if env.storage().persistent().has(&evidence_key) {
                    Self::bump_record_ttl(&env, &evidence_key);
                }
            }
        }
        for index in 0..actors.len() {
            let actor = actors.get(index).ok_or(RegistryError::InvalidRoles)?;
            for role in [Role::Reviewer, Role::Arbitrator] {
                let role_key = DataKey::RoleAccepted(project_id, role, actor.clone());
                if env.storage().persistent().has(&role_key) {
                    Self::bump_record_ttl(&env, &role_key);
                }
            }
            for milestone in 0..project.milestone_count {
                for attempt in 1..=project.policy.max_attempts {
                    for key in [
                        DataKey::Attestation(project_id, milestone, attempt, actor.clone()),
                        DataKey::ContributorVote(project_id, milestone, attempt, actor.clone()),
                        DataKey::ArbitrationVote(project_id, milestone, attempt, actor.clone()),
                    ] {
                        if env.storage().persistent().has(&key) {
                            Self::bump_record_ttl(&env, &key);
                        }
                    }
                }
            }
        }
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    fn accept_role(
        env: &Env,
        actor: Address,
        project_id: u64,
        role: Role,
    ) -> Result<(), RegistryError> {
        let config = Self::config(env)?;
        Self::require_new_activity(&config)?;
        actor.require_auth();
        let project = Self::project(env, project_id)?;
        if project.status != ProjectStatus::Draft {
            return Err(RegistryError::InvalidState);
        }
        let members = match role {
            Role::Reviewer => &project.reviewers,
            Role::Arbitrator => &project.arbitrators,
        };
        if !Self::contains_address(members, &actor) {
            return Err(RegistryError::Unauthorized);
        }
        let key = DataKey::RoleAccepted(project_id, role, actor.clone());
        if env.storage().persistent().has(&key) {
            return Err(RegistryError::AlreadyAccepted);
        }
        env.storage().persistent().set(&key, &true);
        Self::bump_record_ttl(env, &key);
        Self::bump_instance_ttl(env);
        RoleAccepted {
            schema_version: PROTOCOL_VERSION,
            project_id,
            role,
            actor,
        }
        .publish(env);
        Ok(())
    }

    fn timeout_to_rejected(
        env: &Env,
        config: &RegistryConfig,
        project: Project,
        mut milestone: Milestone,
        now: u64,
    ) -> Result<ProjectStatus, RegistryError> {
        let key = DataKey::Milestones(project.id);
        let mut milestones = Self::milestones(env, project.id)?;
        let previous = milestone.status;
        Self::mark_rejected(&mut milestone, &project.policy, now)?;
        milestones.set(project.current_milestone, milestone.clone());
        env.storage().persistent().set(&key, &milestones);
        Self::bump_record_ttl(env, &key);
        Self::bump_instance_ttl(env);
        Self::publish_milestone_state(
            env,
            project.id,
            project.current_milestone,
            milestone.attempt,
            previous,
            milestone.status,
        );
        if milestone.attempt >= project.policy.max_attempts {
            Self::fail_project(env, config, project.id)
        } else {
            Ok(ProjectStatus::Active)
        }
    }

    fn fail_project(
        env: &Env,
        config: &RegistryConfig,
        project_id: u64,
    ) -> Result<ProjectStatus, RegistryError> {
        let key = DataKey::Project(project_id);
        let mut project = Self::project(env, project_id)?;
        let previous = project.status;
        project.status = ProjectStatus::Failed;
        EscrowClient::new(env, &config.escrow).enable_refunds(&project_id);
        env.storage().persistent().set(&key, &project);
        Self::bump_record_ttl(env, &key);
        Self::bump_instance_ttl(env);
        Self::publish_project_state(env, project_id, previous, project.status);
        Ok(project.status)
    }

    fn mark_rejected(
        milestone: &mut Milestone,
        policy: &ProtocolPolicy,
        now: u64,
    ) -> Result<(), RegistryError> {
        milestone.status = MilestoneStatus::Rejected;
        milestone.stage_started_at = now;
        milestone.rework_deadline = now
            .checked_add(policy.rework_window)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        Ok(())
    }

    fn reset_for_rework(
        milestone: &mut Milestone,
        policy: &ProtocolPolicy,
        now: u64,
    ) -> Result<(), RegistryError> {
        if milestone.attempt >= policy.max_attempts {
            return Err(RegistryError::AttemptsExhausted);
        }
        milestone.attempt = milestone
            .attempt
            .checked_add(1)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        milestone.status = MilestoneStatus::Pending;
        milestone.evidence_due_at = now
            .checked_add(policy.rework_window)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        milestone.stage_started_at = now;
        milestone.review_deadline = 0;
        milestone.voting_deadline = 0;
        milestone.dispute_deadline = 0;
        milestone.rework_deadline = 0;
        milestone.verify_count = 0;
        milestone.reject_count = 0;
        milestone.approve_weight = 0;
        milestone.dispute_weight = 0;
        milestone.arbitration_approve = 0;
        milestone.arbitration_reject = 0;
        milestone.arbitration_rework = 0;
        Ok(())
    }

    fn validate_project_input(
        env: &Env,
        config: &RegistryConfig,
        _creator: &Address,
        input: &ProjectInput,
        milestones: &Vec<MilestoneInput>,
        now: u64,
    ) -> Result<(), RegistryError> {
        if input.goal <= 0 {
            return Err(RegistryError::InvalidGoal);
        }
        if input.funding_deadline <= now
            || input.funding_deadline
                > now
                    .checked_add(config.standard_policy.max_funding_window)
                    .ok_or(RegistryError::ArithmeticOverflow)?
        {
            return Err(RegistryError::InvalidDeadline);
        }
        let asset_policy = Self::asset_policy_internal(env, &input.asset)?;
        if !asset_policy.enabled_for_new_projects || input.goal > asset_policy.max_goal {
            return Err(RegistryError::UnsupportedAsset);
        }
        let per_contributor_cap = input
            .goal
            .checked_mul(config.standard_policy.max_contribution_bps as i128)
            .ok_or(RegistryError::ArithmeticOverflow)?
            / BPS_DENOMINATOR;
        let minimum_fundable_goal = asset_policy
            .min_contribution
            .checked_mul(config.standard_policy.min_contributors as i128)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        if per_contributor_cap < asset_policy.min_contribution || input.goal < minimum_fundable_goal
        {
            return Err(RegistryError::InvalidGoal);
        }
        if milestones.len() < MIN_MILESTONES || milestones.len() > MAX_MILESTONES {
            return Err(RegistryError::InvalidMilestones);
        }
        let mut sum = 0i128;
        for index in 0..milestones.len() {
            let milestone = milestones
                .get(index)
                .ok_or(RegistryError::InvalidMilestones)?;
            if milestone.amount <= 0 || milestone.delivery_window == 0 {
                return Err(RegistryError::InvalidMilestones);
            }
            sum = sum
                .checked_add(milestone.amount)
                .ok_or(RegistryError::ArithmeticOverflow)?;
        }
        if sum != input.goal {
            return Err(RegistryError::InvalidMilestones);
        }
        Ok(())
    }

    fn validate_roles(
        creator: &Address,
        payout: &Address,
        roles: &ReviewConfig,
        policy: &ProtocolPolicy,
    ) -> Result<(), RegistryError> {
        if roles.reviewers.len() != policy.reviewer_count
            || roles.arbitrators.len() != policy.arbitrator_count
        {
            return Err(RegistryError::InvalidRoles);
        }
        for index in 0..roles.reviewers.len() {
            let reviewer = roles
                .reviewers
                .get(index)
                .ok_or(RegistryError::InvalidRoles)?;
            if reviewer == *creator
                || reviewer == *payout
                || Self::address_seen_before(&roles.reviewers, index, &reviewer)
                || Self::contains_address(&roles.arbitrators, &reviewer)
            {
                return Err(RegistryError::RoleConflict);
            }
        }
        for index in 0..roles.arbitrators.len() {
            let arbitrator = roles
                .arbitrators
                .get(index)
                .ok_or(RegistryError::InvalidRoles)?;
            if arbitrator == *creator
                || arbitrator == *payout
                || Self::address_seen_before(&roles.arbitrators, index, &arbitrator)
            {
                return Err(RegistryError::RoleConflict);
            }
        }
        Ok(())
    }

    fn validate_protocol_policy(policy: &ProtocolPolicy) -> Result<(), RegistryError> {
        if policy.reviewer_count < 2
            || policy.reviewer_count > 5
            || policy.reviewer_threshold == 0
            || policy.reviewer_threshold > policy.reviewer_count
            || policy.arbitrator_count < 2
            || policy.arbitrator_count > 5
            || policy.arbitrator_threshold == 0
            || policy.arbitrator_threshold > policy.arbitrator_count
            || policy.min_contributors < 2
            || policy.max_attempts == 0
            || policy.quorum_bps == 0
            || policy.quorum_bps > BPS_DENOMINATOR as u32
            || policy.approval_bps == 0
            || policy.approval_bps > BPS_DENOMINATOR as u32
            || policy.dispute_bps == 0
            || policy.dispute_bps > BPS_DENOMINATOR as u32
            || policy.max_contribution_bps == 0
            || policy.max_contribution_bps > BPS_DENOMINATOR as u32
            || policy.max_vote_power_bps == 0
            || policy.max_vote_power_bps > policy.max_contribution_bps
            || policy.max_funding_window == 0
            || policy.activation_window == 0
            || policy.review_window == 0
            || policy.voting_window == 0
            || policy.arbitration_window == 0
            || policy.rework_window == 0
        {
            return Err(RegistryError::InvalidPolicy);
        }
        Ok(())
    }

    fn validate_asset_policy(policy: &AssetPolicy) -> Result<(), RegistryError> {
        if policy.decimals > 18
            || policy.min_contribution <= 0
            || policy.max_goal <= 0
            || policy.min_contribution > policy.max_goal
        {
            return Err(RegistryError::InvalidPolicy);
        }
        Ok(())
    }

    fn all_roles_accepted(env: &Env, project: &Project) -> bool {
        for index in 0..project.reviewers.len() {
            if let Some(actor) = project.reviewers.get(index) {
                if !Self::role_is_accepted(env, project.id, Role::Reviewer, &actor) {
                    return false;
                }
            }
        }
        for index in 0..project.arbitrators.len() {
            if let Some(actor) = project.arbitrators.get(index) {
                if !Self::role_is_accepted(env, project.id, Role::Arbitrator, &actor) {
                    return false;
                }
            }
        }
        true
    }

    fn role_is_accepted(env: &Env, project_id: u64, role: Role, actor: &Address) -> bool {
        let key = DataKey::RoleAccepted(project_id, role, actor.clone());
        let accepted = env.storage().persistent().get(&key).unwrap_or(false);
        if accepted {
            Self::bump_record_ttl(env, &key);
        }
        accepted
    }

    fn has_project_role(project: &Project, actor: &Address) -> bool {
        Self::contains_address(&project.reviewers, actor)
            || Self::contains_address(&project.arbitrators, actor)
    }

    fn contains_address(addresses: &Vec<Address>, address: &Address) -> bool {
        for index in 0..addresses.len() {
            if addresses.get(index) == Some(address.clone()) {
                return true;
            }
        }
        false
    }

    fn address_seen_before(addresses: &Vec<Address>, index: u32, address: &Address) -> bool {
        for prior in 0..index {
            if addresses.get(prior) == Some(address.clone()) {
                return true;
            }
        }
        false
    }

    fn voting_power(project: &Project, contribution: i128) -> Result<i128, RegistryError> {
        let cap = project
            .goal
            .checked_mul(project.policy.max_vote_power_bps as i128)
            .ok_or(RegistryError::ArithmeticOverflow)?
            / BPS_DENOMINATOR;
        Ok(if contribution < cap {
            contribution
        } else {
            cap
        })
    }

    fn ratio_reached(
        numerator: i128,
        denominator: i128,
        threshold_bps: u32,
    ) -> Result<bool, RegistryError> {
        if denominator <= 0 {
            return Ok(false);
        }
        let left = numerator
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let right = denominator
            .checked_mul(threshold_bps as i128)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        Ok(left >= right)
    }

    fn config(env: &Env) -> Result<RegistryConfig, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)
    }

    fn project(env: &Env, project_id: u64) -> Result<Project, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Project(project_id))
            .ok_or(RegistryError::ProjectNotFound)
    }

    fn milestones(env: &Env, project_id: u64) -> Result<Vec<Milestone>, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestones(project_id))
            .ok_or(RegistryError::ProjectNotFound)
    }

    fn evidence(
        env: &Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
    ) -> Result<EvidenceCommitment, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Evidence(project_id, milestone, attempt))
            .ok_or(RegistryError::WrongEvidence)
    }

    fn asset_policy_internal(env: &Env, asset: &Address) -> Result<AssetPolicy, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::AssetPolicy(asset.clone()))
            .ok_or(RegistryError::UnsupportedAsset)
    }

    fn effective_now(env: &Env, config: &RegistryConfig) -> Result<u64, RegistryError> {
        let mut paused = config.total_paused_seconds;
        if let Some(started) = config.pause_started_at {
            paused = paused
                .checked_add(
                    env.ledger()
                        .timestamp()
                        .checked_sub(started)
                        .ok_or(RegistryError::ArithmeticOverflow)?,
                )
                .ok_or(RegistryError::ArithmeticOverflow)?;
        }
        env.ledger()
            .timestamp()
            .checked_sub(paused)
            .ok_or(RegistryError::ArithmeticOverflow)
    }

    fn require_new_activity(config: &RegistryConfig) -> Result<(), RegistryError> {
        if config.pause_mode != PauseMode::Running {
            return Err(RegistryError::Paused);
        }
        Ok(())
    }

    fn require_risky_mutation(config: &RegistryConfig) -> Result<(), RegistryError> {
        if config.pause_mode == PauseMode::PauseRiskyMutations {
            return Err(RegistryError::Paused);
        }
        Ok(())
    }

    fn pause_rank(mode: PauseMode) -> u32 {
        match mode {
            PauseMode::Running => 0,
            PauseMode::PauseNewActivity => 1,
            PauseMode::PauseRiskyMutations => 2,
        }
    }

    fn publish_project_state(
        env: &Env,
        project_id: u64,
        previous: ProjectStatus,
        current: ProjectStatus,
    ) {
        ProjectStateChanged {
            schema_version: PROTOCOL_VERSION,
            project_id,
            previous,
            current,
        }
        .publish(env);
    }

    fn publish_milestone_state(
        env: &Env,
        project_id: u64,
        milestone: u32,
        attempt: u32,
        previous: MilestoneStatus,
        current: MilestoneStatus,
    ) {
        MilestoneStateChanged {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone,
            attempt,
            previous,
            current,
        }
        .publish(env);
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    fn bump_record_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, RECORD_TTL_THRESHOLD, RECORD_TTL_EXTEND_TO);
    }
}

mod test;
