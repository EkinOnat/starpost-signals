# Level 5 user onboarding and growth playbook

## Audience and channels

Recruit community organizers, NGO and diaspora volunteers, university clubs, Stellar builders, public-goods contributors, and independent reviewers. Use direct invitations, community calls, university groups, ecosystem forums, and partner introductions. Do not offer Testnet assets as financial rewards or imply investment returns.

## Qualification

A counted participant must be a new, real, independent person who:

1. controls a unique Stellar Testnet wallet and unique email;
2. reads the Testnet/public-activity notice;
3. completes at least one approved Starpost contract transaction;
4. waits for RPC confirmation and keeps the Explorer link;
5. submits the complete feedback form and both consent fields; and
6. passes local, RPC, Horizon, event, and actor verification.

Existing Level 4 participants, team wallets, automated accounts, failed transactions, duplicates, and incomplete forms do not count toward the new 50.

## Facilitator script

1. Share the live app and ask the participant to choose **Start**.
2. Let the participant choose a persona; do not tell them which rating or feedback to provide.
3. Help only with wallet installation, Testnet selection, Friendbot, transaction status, or retry guidance.
4. Never view or request a secret key or recovery phrase.
5. Ask the participant to complete the action in their own wallet and wait for confirmation.
6. Ask them to copy the confirmed wallet and transaction hash into the Level 5 form.
7. Confirm that the form response arrived; do not edit their rating or comments.

## Three-wave campaign

| Wave | New qualified users | Gate before continuing |
| --- | ---: | --- |
| Pilot | 10 | Fix every transaction/security blocker and the highest-priority usability theme |
| Validation | 20 | Compare funnel and ratings; ship the second feedback-driven improvement |
| Scale | 20 | Close the cohort only after 50 total records pass verification |

Recruit replacement participants whenever a record is invalid. The campaign target is 50 qualified users, not merely 50 invitations or form submissions.

## Lifecycle depth

At least ten participants must complete actions beyond the Signals vote. Across those users, preserve evidence for contribution plus one complete creator/reviewer/contributor approval and payout lifecycle. Assign roles before the session so contract role-separation rules remain valid.

## Funnel and retention

Track aggregate events only:

```text
onboarding_role_selected
→ onboarding_wallet_ready
→ onboarding_action_started
→ onboarding_action_confirmed
→ feedback_opened
```

The private response sheet supplies the actual form-completion count. Invite participants who consent to follow-up to perform a second distinct action after seven days. Report the observed repeat count and rate even if they miss the internal target; never fabricate retention.

## Troubleshooting

- **Wallet unavailable:** install/unlock a supported wallet and retry the picker.
- **Wrong network:** switch the wallet to Stellar Testnet, disconnect, and reconnect.
- **Zero balance:** use Friendbot from the onboarding readiness step.
- **Low but nonzero balance:** switch to an eligible funded Testnet account; Friendbot may reject repeat funding.
- **Rejected signature:** nothing was submitted; review and retry when ready.
- **Pending timeout:** preserve the hash and check Explorer. Do not submit the form until RPC reports success.
- **Already voted:** choose a deeper role/action or use a genuinely new participant wallet; never create a duplicate record.
