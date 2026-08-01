#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String, Vec,
};

const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 100_000;
const VOTER_TTL_THRESHOLD: u32 = 50_000;
const VOTER_TTL_EXTEND_TO: u32 = 100_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PollConfig {
    pub admin: Address,
    pub question: String,
    pub options: Vec<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PollResults {
    pub question: String,
    pub options: Vec<String>,
    pub counts: Vec<u32>,
    pub total: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteReceipt {
    pub option: u32,
    pub option_total: u32,
    pub total: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Counts,
    Total,
    Voter(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidOptions = 3,
    InvalidOption = 4,
    AlreadyVoted = 5,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCast {
    #[topic]
    pub voter: Address,
    #[topic]
    pub option: u32,
    pub option_total: u32,
    pub total: u32,
}

#[contract]
pub struct SignalsContract;

#[contractimpl]
impl SignalsContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        question: String,
        options: Vec<String>,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(ContractError::AlreadyInitialized);
        }

        if options.len() < 2 || options.len() > 4 {
            return Err(ContractError::InvalidOptions);
        }

        admin.require_auth();

        let config = PollConfig {
            admin,
            question,
            options: options.clone(),
        };
        let mut counts: Vec<u32> = Vec::new(&env);
        for _ in 0..options.len() {
            counts.push_back(0);
        }

        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Counts, &counts);
        env.storage().instance().set(&DataKey::Total, &0u32);
        Self::bump_instance_ttl(&env);

        Ok(())
    }

    pub fn vote(env: Env, voter: Address, option: u32) -> Result<VoteReceipt, ContractError> {
        let config = Self::read_config(&env)?;
        if option >= config.options.len() {
            return Err(ContractError::InvalidOption);
        }

        voter.require_auth();
        let voter_key = DataKey::Voter(voter.clone());
        if env.storage().persistent().has(&voter_key) {
            return Err(ContractError::AlreadyVoted);
        }

        let mut counts: Vec<u32> = env
            .storage()
            .instance()
            .get(&DataKey::Counts)
            .ok_or(ContractError::NotInitialized)?;
        let option_total = counts
            .get(option)
            .ok_or(ContractError::InvalidOption)?
            .saturating_add(1);
        counts.set(option, option_total);

        let total: u32 = env
            .storage()
            .instance()
            .get(&DataKey::Total)
            .unwrap_or(0u32)
            .saturating_add(1);

        env.storage().instance().set(&DataKey::Counts, &counts);
        env.storage().instance().set(&DataKey::Total, &total);
        env.storage().persistent().set(&voter_key, &option);
        env.storage()
            .persistent()
            .extend_ttl(&voter_key, VOTER_TTL_THRESHOLD, VOTER_TTL_EXTEND_TO);
        Self::bump_instance_ttl(&env);

        VoteCast {
            voter,
            option,
            option_total,
            total,
        }
        .publish(&env);

        Ok(VoteReceipt {
            option,
            option_total,
            total,
        })
    }

    pub fn get_results(env: Env) -> Result<PollResults, ContractError> {
        let config = Self::read_config(&env)?;
        let counts = env
            .storage()
            .instance()
            .get(&DataKey::Counts)
            .ok_or(ContractError::NotInitialized)?;
        let total = env
            .storage()
            .instance()
            .get(&DataKey::Total)
            .unwrap_or(0u32);
        Self::bump_instance_ttl(&env);

        Ok(PollResults {
            question: config.question,
            options: config.options,
            counts,
            total,
        })
    }

    pub fn get_vote(env: Env, voter: Address) -> Option<u32> {
        let voter_key = DataKey::Voter(voter);
        let vote = env.storage().persistent().get(&voter_key);
        if vote.is_some() {
            env.storage().persistent().extend_ttl(
                &voter_key,
                VOTER_TTL_THRESHOLD,
                VOTER_TTL_EXTEND_TO,
            );
        }
        vote
    }

    fn read_config(env: &Env) -> Result<PollConfig, ContractError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(ContractError::NotInitialized)
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }
}

mod test;
