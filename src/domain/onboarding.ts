export type OnboardingRole = "supporter" | "contributor" | "creator" | "reviewer";

export type OnboardingStep =
  | "welcome"
  | "wallet"
  | "testnet"
  | "action"
  | "confirmation"
  | "feedback";

export type ConfirmedOnboardingAction = {
  action: string;
  transactionHash: string;
};

export interface OnboardingProgress {
  schemaVersion: 1;
  role: OnboardingRole | null;
  step: OnboardingStep;
  completedSteps: OnboardingStep[];
  confirmedAction?: ConfirmedOnboardingAction;
}

export type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const ONBOARDING_STORAGE_KEY = "starpost.level5.onboarding.v1";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "welcome",
  "wallet",
  "testnet",
  "action",
  "confirmation",
  "feedback",
];

export const ROLE_GUIDANCE: Record<OnboardingRole, {
  label: string;
  description: string;
  action: string;
  destination: "signals" | "grants" | "proof";
}> = {
  supporter: {
    label: "Supporter / voter",
    description: "Signal which community need matters most with one permanent Testnet vote.",
    action: "Cast a Signals vote",
    destination: "signals",
  },
  contributor: {
    label: "Contributor",
    description: "Fund a community grant with valueless Testnet XLM and keep its public receipt.",
    action: "Contribute to a grant",
    destination: "grants",
  },
  creator: {
    label: "Project creator",
    description: "Create a milestone project whose evidence and payout rules can be verified publicly.",
    action: "Create a proof project",
    destination: "proof",
  },
  reviewer: {
    label: "Reviewer",
    description: "Inspect content-addressed evidence and attest with an independently assigned wallet.",
    action: "Review milestone evidence",
    destination: "proof",
  },
};

export function createOnboardingProgress(): OnboardingProgress {
  return {
    schemaVersion: 1,
    role: null,
    step: "welcome",
    completedSteps: [],
  };
}

function isRole(value: unknown): value is OnboardingRole {
  return typeof value === "string" && Object.hasOwn(ROLE_GUIDANCE, value);
}

function isStep(value: unknown): value is OnboardingStep {
  return typeof value === "string" && ONBOARDING_STEPS.includes(value as OnboardingStep);
}

export function parseOnboardingProgress(value: unknown): OnboardingProgress {
  if (!value || typeof value !== "object") return createOnboardingProgress();
  const candidate = value as Partial<OnboardingProgress>;
  if (candidate.schemaVersion !== 1 || !isStep(candidate.step)) return createOnboardingProgress();
  if (candidate.role !== null && !isRole(candidate.role)) return createOnboardingProgress();
  if (!Array.isArray(candidate.completedSteps) || !candidate.completedSteps.every(isStep)) {
    return createOnboardingProgress();
  }
  const confirmed = candidate.confirmedAction;
  const confirmedAction = confirmed
    && typeof confirmed.action === "string"
    && /^[0-9a-f]{64}$/i.test(confirmed.transactionHash)
    ? { action: confirmed.action, transactionHash: confirmed.transactionHash.toLowerCase() }
    : undefined;
  return {
    schemaVersion: 1,
    role: candidate.role ?? null,
    step: candidate.step,
    completedSteps: [...new Set(candidate.completedSteps)],
    ...(confirmedAction ? { confirmedAction } : {}),
  };
}

export function loadOnboardingProgress(storage: StoragePort): OnboardingProgress {
  try {
    const serialized = storage.getItem(ONBOARDING_STORAGE_KEY);
    return serialized ? parseOnboardingProgress(JSON.parse(serialized)) : createOnboardingProgress();
  } catch {
    return createOnboardingProgress();
  }
}

export function saveOnboardingProgress(storage: StoragePort, progress: OnboardingProgress) {
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage can be disabled or full. Onboarding remains usable in memory.
  }
}

export function completeOnboardingStep(
  progress: OnboardingProgress,
  current: OnboardingStep,
  next: OnboardingStep,
): OnboardingProgress {
  return {
    ...progress,
    step: next,
    completedSteps: [...new Set([...progress.completedSteps, current])],
  };
}

export function recordConfirmedOnboardingAction(
  progress: OnboardingProgress,
  confirmedAction: ConfirmedOnboardingAction,
): OnboardingProgress {
  return {
    ...completeOnboardingStep(progress, "action", "confirmation"),
    confirmedAction: {
      action: confirmedAction.action,
      transactionHash: confirmedAction.transactionHash.toLowerCase(),
    },
  };
}
