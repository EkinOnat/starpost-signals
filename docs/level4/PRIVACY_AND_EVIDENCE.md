# Privacy and evidence handling

Evidence is public by design. Contributors must have permission to publish it and must not include identity documents, KYC data, financial account details, private addresses, faces without consent, secrets, access tokens, medical information, or unnecessary personal data.

The service stores file bytes, declared media type, size, canonical public metadata, and hashes. The blockchain stores only two SHA-256 values and the attempt number. Web/API logs must not record evidence bodies, wallet secrets, or authorization headers. Full wallet addresses are necessary in public Stellar transactions; analytics should use a rotating salted pseudonym and must never receive evidence content/hash plus a full wallet together.

Operators need an abuse contact, content policy, lawful takedown process, retention policy, and backup deletion process. Removing hosted bytes cannot remove an on-chain hash. The UI therefore asks users to review public content before signing.

Starpost does not perform KYC and must not claim to validate identity, legal compliance, delivery truth, anchor eligibility, or fiat redemption.
