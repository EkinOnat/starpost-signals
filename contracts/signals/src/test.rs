#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    vec, Address, Env, String,
};

fn setup() -> (Env, SignalsContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SignalsContract, ());
    let client = SignalsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let voter = Address::generate(&env);
    let options = vec![
        &env,
        String::from_str(&env, "Payments"),
        String::from_str(&env, "Identity"),
        String::from_str(&env, "Climate"),
        String::from_str(&env, "Gaming"),
    ];
    client.initialize(
        &admin,
        &String::from_str(&env, "What should Stellar build next?"),
        &options,
    );
    (env, client, admin, voter)
}

#[test]
fn initializes_and_reads_empty_results() {
    let (env, client, _, _) = setup();
    let results = client.get_results();

    assert_eq!(results.total, 0);
    assert_eq!(results.options.len(), 4);
    assert_eq!(results.counts, vec![&env, 0, 0, 0, 0]);
    assert_eq!(
        results.question,
        String::from_str(&env, "What should Stellar build next?")
    );
}

#[test]
fn records_vote_and_emits_event() {
    let (env, client, _, voter) = setup();
    let receipt = client.vote(&voter, &2);
    assert_eq!(env.events().all().events().len(), 1);

    let results = client.get_results();

    assert_eq!(receipt.option, 2);
    assert_eq!(receipt.option_total, 1);
    assert_eq!(receipt.total, 1);
    assert_eq!(results.counts, vec![&env, 0, 0, 1, 0]);
    assert_eq!(client.get_vote(&voter), Some(2));
}

#[test]
fn rejects_duplicate_vote() {
    let (_, client, _, voter) = setup();
    client.vote(&voter, &1);

    assert_eq!(
        client.try_vote(&voter, &3),
        Err(Ok(ContractError::AlreadyVoted))
    );
}

#[test]
fn rejects_invalid_option() {
    let (_, client, _, voter) = setup();

    assert_eq!(
        client.try_vote(&voter, &9),
        Err(Ok(ContractError::InvalidOption))
    );
}

#[test]
fn rejects_invalid_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(SignalsContract, ());
    let client = SignalsContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    assert_eq!(
        client.try_initialize(
            &admin,
            &String::from_str(&env, "Too small"),
            &vec![&env, String::from_str(&env, "Only one")],
        ),
        Err(Ok(ContractError::InvalidOptions))
    );
}
