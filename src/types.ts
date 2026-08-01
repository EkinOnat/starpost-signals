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
  | "simulating"
  | "awaiting_signature"
  | "pending"
  | "success"
  | "failed";

export type AppErrorCode =
  | "WALLET_UNAVAILABLE"
  | "USER_REJECTED"
  | "INSUFFICIENT_BALANCE"
  | "WRONG_NETWORK"
  | "ALREADY_VOTED"
  | "NETWORK_ERROR";

export type FriendlyError = {
  code: AppErrorCode;
  title: string;
  message: string;
};
