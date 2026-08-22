# Level 5 Google Form specification

## Form metadata

- **Title:** Starpost Signals — Level 5 Testnet Feedback
- **Description:** Complete this form only after a confirmed Starpost Signals transaction. Stellar Testnet assets have no value. Wallet addresses and transaction hashes are public on-chain. Names and emails are retained privately for cohort validation and removed from the public workbook.
- Collect email addresses through an explicit required question rather than Google sign-in, so independent participants are not required to use a Google account.
- Do not enable file uploads, quiz mode, response editing, or public response summaries.
- Link responses to a private Google Sheet owned by the project operator.

## Required questions

| # | Question | Type | Validation / choices |
| --- | --- | --- | --- |
| 1 | Name | Short answer | Required |
| 2 | Email | Short answer | Required; email validation |
| 3 | Stellar Testnet public wallet address | Short answer | Required; regex `^G[A-Z2-7]{55}$` |
| 4 | Confirmed Testnet transaction hash | Short answer | Required; regex `^[0-9a-fA-F]{64}$` |
| 5 | Contract ID used | Short answer | Required; copy from the confirmation or Explorer |
| 6 | Action completed | Dropdown | `signal_vote`, `grant_created`, `grant_contribution`, `milestone_vote`, `project_created`, `role_accepted`, `impact_contribution`, `evidence_submitted`, `reviewer_attestation`, `contributor_vote`, `arbitration_vote`, `payout_released`, `refund_claimed` |
| 7 | Your role | Multiple choice | Supporter, contributor, creator, reviewer |
| 8 | Overall product rating | Linear scale | 1 = very poor, 5 = excellent |
| 9 | Ease of wallet connection | Linear scale | 1 = very difficult, 5 = very easy |
| 10 | Clarity of the product flow | Linear scale | 1 = unclear, 5 = very clear |
| 11 | Understanding of milestone verification | Linear scale | 1 = unclear, 5 = very clear |
| 12 | Trust in the payout rules | Linear scale | 1 = low trust, 5 = high trust |
| 13 | Most confusing step | Paragraph | Required; “None” is allowed |
| 14 | Most valuable feature | Paragraph | Required |
| 15 | One improvement request | Paragraph | Required |
| 16 | Would you use Starpost Signals again? | Multiple choice | Yes, maybe, no |
| 17 | Testnet acknowledgement | Checkbox | Required single choice: “I understand this exercise uses public Stellar Testnet activity and valueless test assets.” |
| 18 | Verification consent | Checkbox | Required single choice: “I consent to Starpost verifying this wallet and transaction for the Level 5 cohort.” |
| 19 | Anonymized publication consent | Checkbox | Required single choice: “I consent to an anonymized response appearing in public submission evidence; my name and email will be removed.” |

Google Forms adds the response timestamp automatically. Rename exported columns to the exact private verifier schema before running the script:

```text
timestamp,name,email,wallet_address,transaction_hash,contract_id,action,role,overall_rating,wallet_ease,flow_clarity,milestone_understanding,payout_trust,most_confusing_step,most_valuable_feature,improvement_request,would_use_again,testnet_acknowledgement,consent_verification,consent_anonymized_publication
```

## Confirmation message

> Thank you. Keep your transaction hash. Your response counts only after the automated verifier confirms the Testnet transaction, approved Starpost contract, actor wallet, and consent fields. Never share a secret key or recovery phrase.

## Operator workflow

1. Keep the form and linked response Sheet restricted to the owner and named judges.
2. Export responses as `.xlsx` for private record-keeping and `.csv` for verification.
3. Run `npm run verify:level5 -- <private-raw.csv>` outside the repository.
4. Manually review sanitized free text for accidental personal information.
5. Publish only the generated sanitized CSV, workbook, and verification JSON.

