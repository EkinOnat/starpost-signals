export type PollResults = {
  question: string;
  options: string[];
  counts: number[];
  total: number;
};

export type VoteEvent = {
  id: string;
  voter: string;
  option: number;
  optionTotal: number;
  total: number;
  txHash: string;
  ledger: number;
  closedAt: string;
};

export type TransactionStage =
  | "idle"
  | "validating"
  | "simulating"
  | "awaiting_signature"
  | "submitted"
  | "pending"
  | "success"
  | "failed";

export type TransactionState = {
  stage: TransactionStage;
  hash: string | null;
  label: string;
  error: FriendlyError | null;
};

export type AppErrorCode =
  | "WALLET_UNAVAILABLE"
  | "USER_REJECTED"
  | "INSUFFICIENT_BALANCE"
  | "WRONG_NETWORK"
  | "ALREADY_VOTED"
  | "INVALID_GRANT"
  | "FUNDING_CLOSED"
  | "GOAL_EXCEEDED"
  | "NO_VOTING_POWER"
  | "DUPLICATE_VOTE"
  | "QUORUM_NOT_MET"
  | "APPROVAL_NOT_MET"
  | "REFUND_UNAVAILABLE"
  | "CONTRACT_PAUSED"
  | "PENDING_TIMEOUT"
  | "GRANTS_NOT_DEPLOYED"
  | "NETWORK_ERROR";

export type FriendlyError = {
  code: AppErrorCode;
  title: string;
  message: string;
};
