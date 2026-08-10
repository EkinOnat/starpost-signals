#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    Env, String, Vec,
};

const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 120_000;
const RECORD_TTL_THRESHOLD: u32 = 50_000;
const RECORD_TTL_EXTEND_TO: u32 = 120_000;
const BPS_DENOMINATOR: i128 = 10_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryConfig {
    pub admin: Address,
    pub signals: Address,
    pub escrow: Address,
    pub paused: bool,
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
pub struct MilestoneInput {
    pub title: String,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GrantStatus {
    Funding,
    Active,
    Failed,
    Cancelled,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Voting,
    Released,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Grant {
    pub id: u64,
    pub creator: Address,
    pub category: u32,
    pub title: String,
    pub asset: Address,
    pub goal: i128,
    pub deadline: u64,
    pub approval_bps: u32,
    pub quorum_bps: u32,
    pub status: GrantStatus,
    pub current_milestone: u32,
    pub milestone_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub index: u32,
    pub title: String,
    pub amount: i128,
    pub yes_weight: i128,
    pub no_weight: i128,
    pub status: MilestoneStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    NextGrantId,
    Grant(u64),
    Milestones(u64),
    Voted(u64, u32, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    GrantNotFound = 4,
    InvalidCategory = 5,
    InvalidGoal = 6,
    InvalidDeadline = 7,
    InvalidMilestones = 8,
    InvalidThreshold = 9,
    InvalidState = 10,
    FundingOpen = 11,
    NoVotingPower = 12,
    AlreadyVoted = 13,
    QuorumNotMet = 14,
    ApprovalNotMet = 15,
    Unauthorized = 16,
    ArithmeticOverflow = 17,
}

#[contractclient(name = "SignalsClient")]
pub trait SignalsInterface {
    fn get_results(env: Env) -> SignalsResults;
}

#[contractclient(name = "EscrowClient")]
pub trait EscrowInterface {
    fn open_grant(
        env: Env,
        grant_id: u64,
        creator: Address,
        asset: Address,
        goal: i128,
        deadline: u64,
    );
    fn release(env: Env, grant_id: u64, milestone: u32, amount: i128);
    fn set_refundable(env: Env, grant_id: u64);
    fn total(env: Env, grant_id: u64) -> i128;
    fn contribution(env: Env, grant_id: u64, contributor: Address) -> i128;
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantCreated {
    #[topic]
    pub grant_id: u64,
    #[topic]
    pub category: u32,
    pub creator: Address,
    pub title: String,
    pub goal: i128,
    pub deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundingFinalized {
    #[topic]
    pub grant_id: u64,
    pub funded: bool,
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneVoteCast {
    #[topic]
    pub grant_id: u64,
    #[topic]
    pub milestone: u32,
    pub voter: Address,
    pub approve: bool,
    pub weight: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApproved {
    #[topic]
    pub grant_id: u64,
    #[topic]
    pub milestone: u32,
    pub amount: i128,
    pub completed: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantCancelled {
    #[topic]
    pub grant_id: u64,
    pub creator: Address,
}

#[contract]
pub struct GrantRegistryContract;

#[contractimpl]
impl GrantRegistryContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        signals: Address,
        escrow: Address,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(
            &DataKey::Config,
            &RegistryConfig {
                admin,
                signals,
                escrow,
                paused: false,
            },
        );
        env.storage().instance().set(&DataKey::NextGrantId, &1u64);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_grant(
        env: Env,
        creator: Address,
        category: u32,
        title: String,
        asset: Address,
        goal: i128,
        deadline: u64,
        milestones: Vec<MilestoneInput>,
        approval_bps: u32,
        quorum_bps: u32,
    ) -> Result<u64, RegistryError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(RegistryError::Paused);
        }
        creator.require_auth();
        if goal <= 0 {
            return Err(RegistryError::InvalidGoal);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(RegistryError::InvalidDeadline);
        }
        if approval_bps == 0
            || approval_bps > BPS_DENOMINATOR as u32
            || quorum_bps == 0
            || quorum_bps > BPS_DENOMINATOR as u32
        {
            return Err(RegistryError::InvalidThreshold);
        }

        let results = SignalsClient::new(&env, &config.signals).get_results();
        if category >= results.options.len() {
            return Err(RegistryError::InvalidCategory);
        }
        if milestones.len() < 2 || milestones.len() > 5 {
            return Err(RegistryError::InvalidMilestones);
        }

        let mut total = 0i128;
        let mut stored: Vec<Milestone> = Vec::new(&env);
        for index in 0..milestones.len() {
            let item = milestones
                .get(index)
                .ok_or(RegistryError::InvalidMilestones)?;
            if item.amount <= 0 {
                return Err(RegistryError::InvalidMilestones);
            }
            total = total
                .checked_add(item.amount)
                .ok_or(RegistryError::ArithmeticOverflow)?;
            stored.push_back(Milestone {
                index,
                title: item.title,
                amount: item.amount,
                yes_weight: 0,
                no_weight: 0,
                status: if index == 0 {
                    MilestoneStatus::Voting
                } else {
                    MilestoneStatus::Pending
                },
            });
        }
        if total != goal {
            return Err(RegistryError::InvalidMilestones);
        }

        let grant_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextGrantId)
            .unwrap_or(1);
        let next_id = grant_id
            .checked_add(1)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let grant = Grant {
            id: grant_id,
            creator: creator.clone(),
            category,
            title: title.clone(),
            asset: asset.clone(),
            goal,
            deadline,
            approval_bps,
            quorum_bps,
            status: GrantStatus::Funding,
            current_milestone: 0,
            milestone_count: stored.len(),
        };

        EscrowClient::new(&env, &config.escrow)
            .open_grant(&grant_id, &creator, &asset, &goal, &deadline);
        let grant_key = DataKey::Grant(grant_id);
        let milestones_key = DataKey::Milestones(grant_id);
        env.storage().persistent().set(&grant_key, &grant);
        env.storage().persistent().set(&milestones_key, &stored);
        env.storage()
            .instance()
            .set(&DataKey::NextGrantId, &next_id);
        Self::bump_record_ttl(&env, &grant_key);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_instance_ttl(&env);
        GrantCreated {
            grant_id,
            category,
            creator,
            title,
            goal,
            deadline,
        }
        .publish(&env);
        Ok(grant_id)
    }

    pub fn finalize_funding(env: Env, grant_id: u64) -> Result<bool, RegistryError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(RegistryError::Paused);
        }
        let key = DataKey::Grant(grant_id);
        let mut grant = Self::grant(&env, grant_id)?;
        if grant.status != GrantStatus::Funding {
            return Err(RegistryError::InvalidState);
        }
        let total = EscrowClient::new(&env, &config.escrow).total(&grant_id);
        if total < grant.goal && env.ledger().timestamp() < grant.deadline {
            return Err(RegistryError::FundingOpen);
        }
        let funded = total == grant.goal;
        grant.status = if funded {
            GrantStatus::Active
        } else {
            EscrowClient::new(&env, &config.escrow).set_refundable(&grant_id);
            GrantStatus::Failed
        };
        env.storage().persistent().set(&key, &grant);
        Self::bump_record_ttl(&env, &key);
        FundingFinalized {
            grant_id,
            funded,
            total,
        }
        .publish(&env);
        Ok(funded)
    }

    pub fn vote_milestone(
        env: Env,
        grant_id: u64,
        voter: Address,
        approve: bool,
    ) -> Result<i128, RegistryError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(RegistryError::Paused);
        }
        voter.require_auth();
        let grant = Self::grant(&env, grant_id)?;
        if grant.status != GrantStatus::Active {
            return Err(RegistryError::InvalidState);
        }
        let vote_key = DataKey::Voted(grant_id, grant.current_milestone, voter.clone());
        if env.storage().persistent().has(&vote_key) {
            return Err(RegistryError::AlreadyVoted);
        }
        let weight = EscrowClient::new(&env, &config.escrow).contribution(&grant_id, &voter);
        if weight <= 0 {
            return Err(RegistryError::NoVotingPower);
        }

        let milestones_key = DataKey::Milestones(grant_id);
        let mut milestones = Self::milestones(&env, grant_id)?;
        let mut milestone = milestones
            .get(grant.current_milestone)
            .ok_or(RegistryError::InvalidState)?;
        if milestone.status != MilestoneStatus::Voting {
            return Err(RegistryError::InvalidState);
        }
        if approve {
            milestone.yes_weight = milestone
                .yes_weight
                .checked_add(weight)
                .ok_or(RegistryError::ArithmeticOverflow)?;
        } else {
            milestone.no_weight = milestone
                .no_weight
                .checked_add(weight)
                .ok_or(RegistryError::ArithmeticOverflow)?;
        }
        milestones.set(grant.current_milestone, milestone);
        env.storage().persistent().set(&milestones_key, &milestones);
        env.storage().persistent().set(&vote_key, &approve);
        Self::bump_record_ttl(&env, &milestones_key);
        Self::bump_record_ttl(&env, &vote_key);
        MilestoneVoteCast {
            grant_id,
            milestone: grant.current_milestone,
            voter,
            approve,
            weight,
        }
        .publish(&env);
        Ok(weight)
    }

    pub fn finalize_milestone(env: Env, grant_id: u64) -> Result<bool, RegistryError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(RegistryError::Paused);
        }
        let grant_key = DataKey::Grant(grant_id);
        let milestones_key = DataKey::Milestones(grant_id);
        let mut grant = Self::grant(&env, grant_id)?;
        if grant.status != GrantStatus::Active {
            return Err(RegistryError::InvalidState);
        }
        let mut milestones = Self::milestones(&env, grant_id)?;
        let mut milestone = milestones
            .get(grant.current_milestone)
            .ok_or(RegistryError::InvalidState)?;
        if milestone.status != MilestoneStatus::Voting {
            return Err(RegistryError::InvalidState);
        }

        let total = EscrowClient::new(&env, &config.escrow).total(&grant_id);
        let participation = milestone
            .yes_weight
            .checked_add(milestone.no_weight)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let quorum_left = participation
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let quorum_right = total
            .checked_mul(grant.quorum_bps as i128)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        if quorum_left < quorum_right {
            return Err(RegistryError::QuorumNotMet);
        }
        let approval_left = milestone
            .yes_weight
            .checked_mul(BPS_DENOMINATOR)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let approval_right = participation
            .checked_mul(grant.approval_bps as i128)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        if approval_left < approval_right {
            return Err(RegistryError::ApprovalNotMet);
        }

        EscrowClient::new(&env, &config.escrow).release(
            &grant_id,
            &grant.current_milestone,
            &milestone.amount,
        );
        milestone.status = MilestoneStatus::Released;
        milestones.set(grant.current_milestone, milestone.clone());
        let completed = grant.current_milestone + 1 == grant.milestone_count;
        if completed {
            grant.status = GrantStatus::Completed;
        } else {
            grant.current_milestone += 1;
            let mut next = milestones
                .get(grant.current_milestone)
                .ok_or(RegistryError::InvalidState)?;
            next.status = MilestoneStatus::Voting;
            milestones.set(grant.current_milestone, next);
        }
        env.storage().persistent().set(&grant_key, &grant);
        env.storage().persistent().set(&milestones_key, &milestones);
        Self::bump_record_ttl(&env, &grant_key);
        Self::bump_record_ttl(&env, &milestones_key);
        MilestoneApproved {
            grant_id,
            milestone: milestone.index,
            amount: milestone.amount,
            completed,
        }
        .publish(&env);
        Ok(completed)
    }

    pub fn cancel_grant(env: Env, grant_id: u64) -> Result<(), RegistryError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(RegistryError::Paused);
        }
        let key = DataKey::Grant(grant_id);
        let mut grant = Self::grant(&env, grant_id)?;
        grant.creator.require_auth();
        if grant.status != GrantStatus::Funding {
            return Err(RegistryError::InvalidState);
        }
        EscrowClient::new(&env, &config.escrow).set_refundable(&grant_id);
        grant.status = GrantStatus::Cancelled;
        env.storage().persistent().set(&key, &grant);
        Self::bump_record_ttl(&env, &key);
        GrantCancelled {
            grant_id,
            creator: grant.creator,
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_paused(env: Env, paused: bool) -> Result<(), RegistryError> {
        let mut config = Self::config(&env)?;
        config.admin.require_auth();
        config.paused = paused;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn get_grant(env: Env, grant_id: u64) -> Result<Grant, RegistryError> {
        let grant = Self::grant(&env, grant_id)?;
        Self::bump_record_ttl(&env, &DataKey::Grant(grant_id));
        Ok(grant)
    }

    pub fn get_milestones(env: Env, grant_id: u64) -> Result<Vec<Milestone>, RegistryError> {
        let milestones = Self::milestones(&env, grant_id)?;
        Self::bump_record_ttl(&env, &DataKey::Milestones(grant_id));
        Ok(milestones)
    }

    pub fn has_voted(env: Env, grant_id: u64, milestone: u32, voter: Address) -> bool {
        let key = DataKey::Voted(grant_id, milestone, voter);
        let voted = env.storage().persistent().has(&key);
        if voted {
            Self::bump_record_ttl(&env, &key);
        }
        voted
    }

    fn config(env: &Env) -> Result<RegistryConfig, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(RegistryError::NotInitialized)
    }

    fn grant(env: &Env, grant_id: u64) -> Result<Grant, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Grant(grant_id))
            .ok_or(RegistryError::GrantNotFound)
    }

    fn milestones(env: &Env, grant_id: u64) -> Result<Vec<Milestone>, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Milestones(grant_id))
            .ok_or(RegistryError::GrantNotFound)
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
