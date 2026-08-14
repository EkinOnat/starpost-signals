#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

const PROTOCOL_VERSION: u32 = 1;
const BPS_DENOMINATOR: i128 = 10_000;
const INSTANCE_TTL_THRESHOLD: u32 = 250_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 2_000_000;
const RECORD_TTL_THRESHOLD: u32 = 250_000;
const RECORD_TTL_EXTEND_TO: u32 = 2_000_000;
const MAX_TOUCH_ADDRESSES: u32 = 20;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PauseMode {
    Running,
    PauseNewActivity,
    PauseRiskyMutations,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowConfig {
    pub governor: Address,
    pub pause_guardian: Address,
    pub registry: Address,
    pub pause_mode: PauseMode,
    pub pending_governor: Option<Address>,
    pub total_paused_seconds: u64,
    pub pause_started_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicy {
    pub enabled_for_new_vaults: bool,
    pub decimals: u32,
    pub min_contribution: i128,
    pub max_goal: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vault {
    pub project_id: u64,
    pub payout: Address,
    pub asset: Address,
    pub goal: i128,
    pub funding_deadline: u64,
    pub milestone_amounts: Vec<i128>,
    pub max_contribution_bps: u32,
    pub deposited: i128,
    pub released: i128,
    pub refunded_total: i128,
    pub remaining_pool: i128,
    pub remaining_shares: i128,
    pub contributor_count: u32,
    pub next_milestone: u32,
    pub funding_locked: bool,
    pub refundable: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    AssetPolicy(Address),
    Vault(u64),
    Contribution(u64, Address),
    RefundReceipt(u64, Address),
    ReleaseReceipt(u64, u32),
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
    InvalidMilestones = 11,
    UnsupportedAsset = 12,
    InvalidState = 13,
    WrongMilestone = 14,
    WrongReleaseAmount = 15,
    AlreadyReleased = 16,
    ReleaseExceeded = 17,
    RefundUnavailable = 18,
    NothingToRefund = 19,
    AlreadyRefunded = 20,
    ArithmeticOverflow = 21,
    BalanceMismatch = 22,
    InvalidPauseTransition = 23,
    TooManyTouchAddresses = 24,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AssetPolicyChanged {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub asset: Address,
    pub enabled_for_new_vaults: bool,
    pub decimals: u32,
    pub min_contribution: i128,
    pub max_goal: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultOpened {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    pub payout: Address,
    pub asset: Address,
    pub goal: i128,
    pub funding_deadline: u64,
    pub milestone_count: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionRecorded {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub contributor_total: i128,
    pub project_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundingLocked {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    pub deposited: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FundsReleased {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub milestone: u32,
    pub amount: i128,
    pub released_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundEnabled {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    pub refund_pool: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundClaimed {
    #[topic]
    pub schema_version: u32,
    #[topic]
    pub project_id: u64,
    #[topic]
    pub contributor: Address,
    pub amount: i128,
    pub remaining_pool: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PauseModeChanged {
    #[topic]
    pub schema_version: u32,
    pub actor: Address,
    pub previous: PauseMode,
    pub current: PauseMode,
}

#[contract]
pub struct ImpactEscrowV1Contract;

#[contractimpl]
impl ImpactEscrowV1Contract {
    pub fn initialize(
        env: Env,
        governor: Address,
        pause_guardian: Address,
        registry: Address,
        initial_asset: Address,
        initial_policy: AssetPolicy,
    ) -> Result<(), EscrowError> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(EscrowError::AlreadyInitialized);
        }
        governor.require_auth();
        Self::validate_asset_policy(&initial_policy)?;
        env.storage().instance().set(
            &DataKey::Config,
            &EscrowConfig {
                governor,
                pause_guardian,
                registry,
                pause_mode: PauseMode::Running,
                pending_governor: None,
                total_paused_seconds: 0,
                pause_started_at: None,
            },
        );
        let asset_key = DataKey::AssetPolicy(initial_asset.clone());
        env.storage().persistent().set(&asset_key, &initial_policy);
        Self::bump_record_ttl(&env, &asset_key);
        Self::bump_instance_ttl(&env);
        AssetPolicyChanged {
            schema_version: PROTOCOL_VERSION,
            asset: initial_asset,
            enabled_for_new_vaults: initial_policy.enabled_for_new_vaults,
            decimals: initial_policy.decimals,
            min_contribution: initial_policy.min_contribution,
            max_goal: initial_policy.max_goal,
        }
        .publish(&env);
        Ok(())
    }

    pub fn version(_env: Env) -> u32 {
        PROTOCOL_VERSION
    }

    pub fn set_asset_policy(
        env: Env,
        asset: Address,
        policy: AssetPolicy,
    ) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        config.governor.require_auth();
        Self::validate_asset_policy(&policy)?;
        let key = DataKey::AssetPolicy(asset.clone());
        env.storage().persistent().set(&key, &policy);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        AssetPolicyChanged {
            schema_version: PROTOCOL_VERSION,
            asset,
            enabled_for_new_vaults: policy.enabled_for_new_vaults,
            decimals: policy.decimals,
            min_contribution: policy.min_contribution,
            max_goal: policy.max_goal,
        }
        .publish(&env);
        Ok(())
    }

    pub fn sync_asset_policy(
        env: Env,
        asset: Address,
        enabled_for_new_vaults: bool,
        decimals: u32,
        min_contribution: i128,
        max_goal: i128,
    ) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        config.governor.require_auth();
        let policy = AssetPolicy {
            enabled_for_new_vaults,
            decimals,
            min_contribution,
            max_goal,
        };
        Self::validate_asset_policy(&policy)?;
        let key = DataKey::AssetPolicy(asset.clone());
        env.storage().persistent().set(&key, &policy);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        AssetPolicyChanged {
            schema_version: PROTOCOL_VERSION,
            asset,
            enabled_for_new_vaults: policy.enabled_for_new_vaults,
            decimals: policy.decimals,
            min_contribution: policy.min_contribution,
            max_goal: policy.max_goal,
        }
        .publish(&env);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_vault(
        env: Env,
        project_id: u64,
        payout: Address,
        asset: Address,
        goal: i128,
        funding_deadline: u64,
        milestone_amounts: Vec<i128>,
        max_contribution_bps: u32,
    ) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        Self::require_new_activity(&config)?;
        if goal <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        if funding_deadline <= Self::effective_now(&env, &config)? {
            return Err(EscrowError::InvalidDeadline);
        }
        if max_contribution_bps == 0 || max_contribution_bps > BPS_DENOMINATOR as u32 {
            return Err(EscrowError::InvalidAmount);
        }
        let asset_policy = Self::asset_policy_internal(&env, &asset)?;
        if !asset_policy.enabled_for_new_vaults || goal > asset_policy.max_goal {
            return Err(EscrowError::UnsupportedAsset);
        }
        if milestone_amounts.len() < 2 || milestone_amounts.len() > 5 {
            return Err(EscrowError::InvalidMilestones);
        }
        let mut sum = 0i128;
        for index in 0..milestone_amounts.len() {
            let amount = milestone_amounts
                .get(index)
                .ok_or(EscrowError::InvalidMilestones)?;
            if amount <= 0 {
                return Err(EscrowError::InvalidMilestones);
            }
            sum = sum
                .checked_add(amount)
                .ok_or(EscrowError::ArithmeticOverflow)?;
        }
        if sum != goal {
            return Err(EscrowError::InvalidMilestones);
        }
        let key = DataKey::Vault(project_id);
        if env.storage().persistent().has(&key) {
            return Err(EscrowError::VaultExists);
        }
        let milestone_count = milestone_amounts.len();
        env.storage().persistent().set(
            &key,
            &Vault {
                project_id,
                payout: payout.clone(),
                asset: asset.clone(),
                goal,
                funding_deadline,
                milestone_amounts,
                max_contribution_bps,
                deposited: 0,
                released: 0,
                refunded_total: 0,
                remaining_pool: 0,
                remaining_shares: 0,
                contributor_count: 0,
                next_milestone: 0,
                funding_locked: false,
                refundable: false,
            },
        );
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        VaultOpened {
            schema_version: PROTOCOL_VERSION,
            project_id,
            payout,
            asset,
            goal,
            funding_deadline,
            milestone_count,
        }
        .publish(&env);
        Ok(())
    }

    pub fn deposit(
        env: Env,
        project_id: u64,
        contributor: Address,
        amount: i128,
    ) -> Result<i128, EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        Self::require_new_activity(&config)?;
        contributor.require_auth();
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        let vault_key = DataKey::Vault(project_id);
        let mut vault = Self::vault(&env, project_id)?;
        if vault.funding_locked
            || vault.refundable
            || Self::effective_now(&env, &config)? >= vault.funding_deadline
        {
            return Err(EscrowError::FundingClosed);
        }
        let policy = Self::asset_policy_internal(&env, &vault.asset)?;
        if amount < policy.min_contribution {
            return Err(EscrowError::InvalidAmount);
        }
        let contribution_key = DataKey::Contribution(project_id, contributor.clone());
        let previous: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);
        let contributor_total = previous
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        let contributor_cap = vault
            .goal
            .checked_mul(vault.max_contribution_bps as i128)
            .ok_or(EscrowError::ArithmeticOverflow)?
            / BPS_DENOMINATOR;
        if contributor_total > contributor_cap {
            return Err(EscrowError::GoalExceeded);
        }
        let project_total = vault
            .deposited
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        if project_total > vault.goal {
            return Err(EscrowError::GoalExceeded);
        }

        let token_client = token::Client::new(&env, &vault.asset);
        let escrow_address = env.current_contract_address();
        let balance_before = token_client.balance(&escrow_address);

        vault.deposited = project_total;
        if previous == 0 {
            vault.contributor_count = vault
                .contributor_count
                .checked_add(1)
                .ok_or(EscrowError::ArithmeticOverflow)?;
        }
        env.storage().persistent().set(&vault_key, &vault);
        env.storage()
            .persistent()
            .set(&contribution_key, &contributor_total);
        token_client.transfer(&contributor, &escrow_address, &amount);
        let balance_after = token_client.balance(&escrow_address);
        if balance_after.checked_sub(balance_before) != Some(amount) {
            return Err(EscrowError::BalanceMismatch);
        }

        Self::bump_record_ttl(&env, &vault_key);
        Self::bump_record_ttl(&env, &contribution_key);
        Self::bump_instance_ttl(&env);
        ContributionRecorded {
            schema_version: PROTOCOL_VERSION,
            project_id,
            contributor,
            amount,
            contributor_total,
            project_total,
        }
        .publish(&env);
        Ok(contributor_total)
    }

    pub fn lock_funding(env: Env, project_id: u64) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        Self::require_risky_mutation(&config)?;
        let key = DataKey::Vault(project_id);
        let mut vault = Self::vault(&env, project_id)?;
        if vault.refundable || vault.funding_locked || vault.deposited != vault.goal {
            return Err(EscrowError::InvalidState);
        }
        vault.funding_locked = true;
        env.storage().persistent().set(&key, &vault);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        FundingLocked {
            schema_version: PROTOCOL_VERSION,
            project_id,
            deposited: vault.deposited,
        }
        .publish(&env);
        Ok(())
    }

    pub fn release_milestone(
        env: Env,
        project_id: u64,
        milestone: u32,
        amount: i128,
    ) -> Result<(), EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        Self::require_risky_mutation(&config)?;
        if amount <= 0 {
            return Err(EscrowError::InvalidAmount);
        }
        let key = DataKey::Vault(project_id);
        let mut vault = Self::vault(&env, project_id)?;
        if !vault.funding_locked || vault.refundable {
            return Err(EscrowError::InvalidState);
        }
        if milestone != vault.next_milestone {
            return Err(EscrowError::WrongMilestone);
        }
        let receipt_key = DataKey::ReleaseReceipt(project_id, milestone);
        if env.storage().persistent().has(&receipt_key) {
            return Err(EscrowError::AlreadyReleased);
        }
        let expected = vault
            .milestone_amounts
            .get(milestone)
            .ok_or(EscrowError::WrongMilestone)?;
        if amount != expected {
            return Err(EscrowError::WrongReleaseAmount);
        }
        let released_total = vault
            .released
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        if released_total > vault.deposited {
            return Err(EscrowError::ReleaseExceeded);
        }

        vault.released = released_total;
        vault.next_milestone = vault
            .next_milestone
            .checked_add(1)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        env.storage().persistent().set(&key, &vault);
        env.storage().persistent().set(&receipt_key, &amount);
        token::Client::new(&env, &vault.asset).transfer(
            &env.current_contract_address(),
            &vault.payout,
            &amount,
        );

        Self::bump_record_ttl(&env, &key);
        Self::bump_record_ttl(&env, &receipt_key);
        Self::bump_instance_ttl(&env);
        FundsReleased {
            schema_version: PROTOCOL_VERSION,
            project_id,
            milestone,
            amount,
            released_total,
        }
        .publish(&env);
        Ok(())
    }

    pub fn enable_refunds(env: Env, project_id: u64) -> Result<i128, EscrowError> {
        let config = Self::config(&env)?;
        Self::require_registry(&config);
        let key = DataKey::Vault(project_id);
        let mut vault = Self::vault(&env, project_id)?;
        if vault.refundable {
            return Err(EscrowError::InvalidState);
        }
        let pool = vault
            .deposited
            .checked_sub(vault.released)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        vault.refundable = true;
        vault.funding_locked = true;
        vault.remaining_pool = pool;
        vault.remaining_shares = vault.deposited;
        env.storage().persistent().set(&key, &vault);
        Self::bump_record_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
        RefundEnabled {
            schema_version: PROTOCOL_VERSION,
            project_id,
            refund_pool: pool,
        }
        .publish(&env);
        Ok(pool)
    }

    pub fn claim_refund(
        env: Env,
        project_id: u64,
        contributor: Address,
    ) -> Result<i128, EscrowError> {
        let _config = Self::config(&env)?;
        contributor.require_auth();
        let vault_key = DataKey::Vault(project_id);
        let mut vault = Self::vault(&env, project_id)?;
        if !vault.refundable {
            return Err(EscrowError::RefundUnavailable);
        }
        let receipt_key = DataKey::RefundReceipt(project_id, contributor.clone());
        if env.storage().persistent().has(&receipt_key) {
            return Err(EscrowError::AlreadyRefunded);
        }
        let contribution_key = DataKey::Contribution(project_id, contributor.clone());
        let contribution: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);
        if contribution <= 0 || contribution > vault.remaining_shares {
            return Err(EscrowError::NothingToRefund);
        }
        let amount = if contribution == vault.remaining_shares {
            vault.remaining_pool
        } else {
            contribution
                .checked_mul(vault.remaining_pool)
                .ok_or(EscrowError::ArithmeticOverflow)?
                / vault.remaining_shares
        };
        vault.remaining_shares = vault
            .remaining_shares
            .checked_sub(contribution)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        vault.remaining_pool = vault
            .remaining_pool
            .checked_sub(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        vault.refunded_total = vault
            .refunded_total
            .checked_add(amount)
            .ok_or(EscrowError::ArithmeticOverflow)?;
        env.storage().persistent().set(&vault_key, &vault);
        env.storage().persistent().set(&receipt_key, &amount);
        token::Client::new(&env, &vault.asset).transfer(
            &env.current_contract_address(),
            &contributor,
            &amount,
        );
        Self::bump_record_ttl(&env, &vault_key);
        Self::bump_record_ttl(&env, &contribution_key);
        Self::bump_record_ttl(&env, &receipt_key);
        Self::bump_instance_ttl(&env);
        RefundClaimed {
            schema_version: PROTOCOL_VERSION,
            project_id,
            contributor,
            amount,
            remaining_pool: vault.remaining_pool,
        }
        .publish(&env);
        Ok(amount)
    }

    pub fn set_pause_mode(env: Env, actor: Address, mode: PauseMode) -> Result<(), EscrowError> {
        let mut config = Self::config(&env)?;
        Self::require_registry(&config);
        if actor == config.governor {
            actor.require_auth();
        } else if actor == config.pause_guardian {
            actor.require_auth();
            if Self::pause_rank(mode) < Self::pause_rank(config.pause_mode) {
                return Err(EscrowError::InvalidPauseTransition);
            }
        } else {
            return Err(EscrowError::Unauthorized);
        }
        let previous = config.pause_mode;
        let was_running = previous == PauseMode::Running;
        let will_run = mode == PauseMode::Running;
        if was_running && !will_run {
            config.pause_started_at = Some(env.ledger().timestamp());
        } else if !was_running && will_run {
            let started = config
                .pause_started_at
                .ok_or(EscrowError::InvalidPauseTransition)?;
            let duration = env
                .ledger()
                .timestamp()
                .checked_sub(started)
                .ok_or(EscrowError::ArithmeticOverflow)?;
            config.total_paused_seconds = config
                .total_paused_seconds
                .checked_add(duration)
                .ok_or(EscrowError::ArithmeticOverflow)?;
            config.pause_started_at = None;
        }
        config.pause_mode = mode;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        PauseModeChanged {
            schema_version: PROTOCOL_VERSION,
            actor,
            previous,
            current: mode,
        }
        .publish(&env);
        Ok(())
    }

    pub fn propose_governor(env: Env, proposed: Address) -> Result<(), EscrowError> {
        let mut config = Self::config(&env)?;
        Self::require_registry(&config);
        config.governor.require_auth();
        config.pending_governor = Some(proposed);
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn accept_governor(env: Env) -> Result<(), EscrowError> {
        let mut config = Self::config(&env)?;
        Self::require_registry(&config);
        let proposed = config
            .pending_governor
            .clone()
            .ok_or(EscrowError::Unauthorized)?;
        proposed.require_auth();
        config.governor = proposed;
        config.pending_governor = None;
        env.storage().instance().set(&DataKey::Config, &config);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn get_config(env: Env) -> Result<EscrowConfig, EscrowError> {
        Self::bump_instance_ttl(&env);
        Self::config(&env)
    }

    pub fn get_asset_policy(env: Env, asset: Address) -> Result<AssetPolicy, EscrowError> {
        let policy = Self::asset_policy_internal(&env, &asset)?;
        Self::bump_record_ttl(&env, &DataKey::AssetPolicy(asset));
        Ok(policy)
    }

    pub fn get_vault(env: Env, project_id: u64) -> Result<Vault, EscrowError> {
        let vault = Self::vault(&env, project_id)?;
        Self::bump_record_ttl(&env, &DataKey::Vault(project_id));
        Ok(vault)
    }

    pub fn total(env: Env, project_id: u64) -> Result<i128, EscrowError> {
        Ok(Self::vault(&env, project_id)?.deposited)
    }

    pub fn contribution(env: Env, project_id: u64, contributor: Address) -> i128 {
        let key = DataKey::Contribution(project_id, contributor);
        let amount = env.storage().persistent().get(&key).unwrap_or(0);
        if amount > 0 {
            Self::bump_record_ttl(&env, &key);
        }
        amount
    }

    pub fn release_receipt(env: Env, project_id: u64, milestone: u32) -> Option<i128> {
        let key = DataKey::ReleaseReceipt(project_id, milestone);
        let receipt = env.storage().persistent().get(&key);
        if receipt.is_some() {
            Self::bump_record_ttl(&env, &key);
        }
        receipt
    }

    pub fn refund_receipt(env: Env, project_id: u64, contributor: Address) -> Option<i128> {
        let key = DataKey::RefundReceipt(project_id, contributor);
        let receipt = env.storage().persistent().get(&key);
        if receipt.is_some() {
            Self::bump_record_ttl(&env, &key);
        }
        receipt
    }

    pub fn touch_vault(
        env: Env,
        project_id: u64,
        contributors: Vec<Address>,
    ) -> Result<(), EscrowError> {
        if contributors.len() > MAX_TOUCH_ADDRESSES {
            return Err(EscrowError::TooManyTouchAddresses);
        }
        let vault_key = DataKey::Vault(project_id);
        if !env.storage().persistent().has(&vault_key) {
            return Err(EscrowError::VaultNotFound);
        }
        Self::bump_record_ttl(&env, &vault_key);
        let vault = Self::vault(&env, project_id)?;
        Self::bump_record_ttl(&env, &DataKey::AssetPolicy(vault.asset));
        for index in 0..contributors.len() {
            let contributor = contributors
                .get(index)
                .ok_or(EscrowError::NothingToRefund)?;
            let contribution_key = DataKey::Contribution(project_id, contributor.clone());
            if env.storage().persistent().has(&contribution_key) {
                Self::bump_record_ttl(&env, &contribution_key);
            }
            let refund_key = DataKey::RefundReceipt(project_id, contributor);
            if env.storage().persistent().has(&refund_key) {
                Self::bump_record_ttl(&env, &refund_key);
            }
        }
        for milestone in 0..vault.milestone_amounts.len() {
            let release_key = DataKey::ReleaseReceipt(project_id, milestone);
            if env.storage().persistent().has(&release_key) {
                Self::bump_record_ttl(&env, &release_key);
            }
        }
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    fn validate_asset_policy(policy: &AssetPolicy) -> Result<(), EscrowError> {
        if policy.decimals > 18
            || policy.min_contribution <= 0
            || policy.max_goal <= 0
            || policy.min_contribution > policy.max_goal
        {
            return Err(EscrowError::InvalidAmount);
        }
        Ok(())
    }

    fn config(env: &Env) -> Result<EscrowConfig, EscrowError> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(EscrowError::NotInitialized)
    }

    fn vault(env: &Env, project_id: u64) -> Result<Vault, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::Vault(project_id))
            .ok_or(EscrowError::VaultNotFound)
    }

    fn asset_policy_internal(env: &Env, asset: &Address) -> Result<AssetPolicy, EscrowError> {
        env.storage()
            .persistent()
            .get(&DataKey::AssetPolicy(asset.clone()))
            .ok_or(EscrowError::UnsupportedAsset)
    }

    fn effective_now(env: &Env, config: &EscrowConfig) -> Result<u64, EscrowError> {
        let mut paused = config.total_paused_seconds;
        if let Some(started) = config.pause_started_at {
            paused = paused
                .checked_add(
                    env.ledger()
                        .timestamp()
                        .checked_sub(started)
                        .ok_or(EscrowError::ArithmeticOverflow)?,
                )
                .ok_or(EscrowError::ArithmeticOverflow)?;
        }
        env.ledger()
            .timestamp()
            .checked_sub(paused)
            .ok_or(EscrowError::ArithmeticOverflow)
    }

    fn require_registry(config: &EscrowConfig) {
        config.registry.require_auth();
    }

    fn require_new_activity(config: &EscrowConfig) -> Result<(), EscrowError> {
        if config.pause_mode != PauseMode::Running {
            return Err(EscrowError::Paused);
        }
        Ok(())
    }

    fn require_risky_mutation(config: &EscrowConfig) -> Result<(), EscrowError> {
        if config.pause_mode == PauseMode::PauseRiskyMutations {
            return Err(EscrowError::Paused);
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
