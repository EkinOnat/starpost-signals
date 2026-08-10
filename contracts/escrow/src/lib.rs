#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env,
};

const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 120_000;
const RECORD_TTL_THRESHOLD: u32 = 50_000;
const RECORD_TTL_EXTEND_TO: u32 = 120_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowConfig {
    pub admin: Address,
    pub registry: Address,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vault {
    pub grant_id: u64,
    pub creator: Address,
    pub asset: Address,
    pub goal: i128,
    pub deadline: u64,
    pub deposited: i128,
    pub released: i128,
    pub refundable: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    Vault(u64),
    Contribution(u64, Address),
    Refunded(u64, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum EscrowError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Paused = 3,
    Unauthorized = 4,
    VaultExists = 5,
    VaultNotFound = 6,
    InvalidAmount = 7,
    InvalidDeadline = 8,
    FundingClosed = 9,
    GoalExceeded = 10,
    ReleaseExceeded = 11,
    RefundUnavailable = 12,
    NothingToRefund = 13,
    AlreadyRefunded = 14,
    ArithmeticOverflow = 15,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultOpened {
    #[topic]
    pub grant_id: u64,
    pub creator: Address,
    pub asset: Address,
    pub goal: i128,
    pub deadline: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionMade {
    #[topic]
    pub grant_id: u64,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundsReleased {
    #[topic]
    pub grant_id: u64,
    #[topic]
    pub milestone: u32,
    pub amount: i128,
    pub released: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundEnabled {
    #[topic]
    pub grant_id: u64,
    pub available: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundClaimed {
    #[topic]
    pub grant_id: u64,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
}

#[contract]
pub struct GrantEscrowContract;

#[contractimpl]
impl GrantEscrowContract {
    pub fn initialize(env: Env, admin: Address, registry: Address) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(EscrowError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(
            &DataKey::Config,
            &EscrowConfig {
                admin,
                registry,
                paused: false,
            },
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn open_grant(
        env: Env,
        grant_id: u64,
        creator: Address,
        asset: Address,
        goal: i128,
        deadline: u64,
    ) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config)?;
        if config.paused {
            return Err(EscrowError::Paused);
        }
        if goal <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(EscrowError::InvalidDeadline);
        }
        let key = DataKey::Vault(grant_id);
        if env.storage().persistent().has(&key) {
            return Err(EscrowError::VaultExists);
        }

        env.storage().persistent().set(
            &key,
            &Vault {
                grant_id,
                creator: creator.clone(),
                asset: asset.clone(),
                goal,
                deadline,
                deposited: 0,
                released: 0,
                refundable: false,
            },
        );
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        VaultOpened {
            grant_id,
            creator,
            asset,
            goal,
            deadline,
        }
        .publish(&env);
        Ok(())
    }

    pub fn contribute(
        env: Env,
        grant_id: u64,
        contributor: Address,
        amount: i128,
    ) -> Result<i128, EscrowError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(EscrowError::Paused);
        }
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        contributor.require_auth();

        let vault_key = DataKey::Vault(grant_id);
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&vault_key)
            .ok_or(EscrowError::VaultNotFound)?;
        if env.ledger().timestamp() >= vault.deadline || vault.deposited == vault.goal {
            return Err(EscrowError::FundingClosed);
        }
        let new_total = vault
            .deposited
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        if new_total > vault.goal {
            return Err(EscrowError::GoalExceeded);
        }

        token::Client::new(&env, &vault.asset).transfer(
            &contributor,
            env.current_contract_address(),
            &amount,
        );

        let contribution_key = DataKey::Contribution(grant_id, contributor.clone());
        let previous: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);
        let contribution = previous
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        vault.deposited = new_total;
        env.storage().persistent().set(&vault_key, &vault);
        env.storage()
            .persistent()
            .set(&contribution_key, &contribution);
        Self::bump_record_ttl(&env, &vault_key);
        Self::bump_record_ttl(&env, &contribution_key);
        ContributionMade {
            grant_id,
            contributor,
            amount,
            total: new_total,
        }
        .publish(&env);
        Ok(new_total)
    }

    pub fn release(
        env: Env,
        grant_id: u64,
        milestone: u32,
        amount: i128,
    ) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config)?;
        if config.paused {
            return Err(EscrowError::Paused);
        }
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }

        let key = DataKey::Vault(grant_id);
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::VaultNotFound)?;
        if vault.refundable {
            return Err(EscrowError::RefundUnavailable);
        }
        let released = vault
            .released
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        if released > vault.deposited {
            return Err(EscrowError::ReleaseExceeded);
        }

        token::Client::new(&env, &vault.asset).transfer(
            &env.current_contract_address(),
            &vault.creator,
            &amount,
        );
        vault.released = released;
        env.storage().persistent().set(&key, &vault);
        Self::bump_record_ttl(&env, &key);
        FundsReleased {
            grant_id,
            milestone,
            amount,
            released,
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_refundable(env: Env, grant_id: u64) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config)?;
        let key = DataKey::Vault(grant_id);
        let mut vault: Vault = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::VaultNotFound)?;
        if vault.released > 0 {
            return Err(EscrowError::RefundUnavailable);
        }
        vault.refundable = true;
        env.storage().persistent().set(&key, &vault);
        Self::bump_record_ttl(&env, &key);
        RefundEnabled {
            grant_id,
            available: vault.deposited,
        }
        .publish(&env);
        Ok(())
    }

    pub fn claim_refund(
        env: Env,
        grant_id: u64,
        contributor: Address,
    ) -> Result<i128, EscrowError> {
        let config = Self::config(&env)?;
        if config.paused {
            return Err(EscrowError::Paused);
        }
        contributor.require_auth();
        let vault = Self::vault(&env, grant_id)?;
        if !vault.refundable {
            return Err(EscrowError::RefundUnavailable);
        }
        let refunded_key = DataKey::Refunded(grant_id, contributor.clone());
        if env.storage().persistent().has(&refunded_key) {
            return Err(EscrowError::AlreadyRefunded);
        }
        let contribution_key = DataKey::Contribution(grant_id, contributor.clone());
        let amount: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);
        if amount <= 0 {
            return Err(EscrowError::NothingToRefund);
        }

        token::Client::new(&env, &vault.asset).transfer(
            &env.current_contract_address(),
            &contributor,
            &amount,
        );
        env.storage().persistent().set(&refunded_key, &true);
        Self::bump_record_ttl(&env, &refunded_key);
        RefundClaimed {
            grant_id,
            contributor,
            amount,
        }
        .publish(&env);
        Ok(amount)
    }

    pub fn set_paused(env: Env, paused: bool) -> Result<(), EscrowError> {
        let mut config = Self::config(&env)?;
        config.admin.require_auth();
        config.paused = paused;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn get_vault(env: Env, grant_id: u64) -> Result<Vault, EscrowError> {
        let vault = Self::vault(&env, grant_id)?;
        Self::bump_record_ttl(&env, &DataKey::Vault(grant_id));
        Ok(vault)
    }

    pub fn total(env: Env, grant_id: u64) -> Result<i128, EscrowError> {
        Ok(Self::vault(&env, grant_id)?.deposited)
    }

    pub fn contribution(env: Env, grant_id: u64, contributor: Address) -> i128 {
        let key = DataKey::Contribution(grant_id, contributor);
        let amount = env.storage().persistent().get(&key).unwrap_or(0);
        if amount > 0 {
            Self::bump_record_ttl(&env, &key);
        }
        amount
    }

    fn config(env: &Env) -> Result<EscrowConfig, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)
    }

    fn require_registry(config: &EscrowConfig) -> Result<(), EscrowError> {
        config.registry.require_auth();
        Ok(())
    }

    fn vault(env: &Env, grant_id: u64) -> Result<Vault, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Vault(grant_id))
            .ok_or(EscrowError::VaultNotFound)
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
