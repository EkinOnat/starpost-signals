import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STORAGE_KEY,
  completeOnboardingStep,
  createOnboardingProgress,
  loadOnboardingProgress,
  parseOnboardingProgress,
  recordConfirmedOnboardingAction,
  saveOnboardingProgress,
  type StoragePort,
} from "./onboarding";

function memoryStorage(initial?: string): StoragePort & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) { return key === ONBOARDING_STORAGE_KEY ? this.value : null; },
    setItem(key, value) { if (key === ONBOARDING_STORAGE_KEY) this.value = value; },
    removeItem(key) { if (key === ONBOARDING_STORAGE_KEY) this.value = null; },
  };
}

describe("Level 5 onboarding progress", () => {
  it("starts without a persona or stored identity", () => {
    expect(createOnboardingProgress()).toEqual({
      schemaVersion: 1,
      role: null,
      step: "welcome",
      completedSteps: [],
    });
  });

  it("advances without duplicating completed steps", () => {
    const wallet = completeOnboardingStep(createOnboardingProgress(), "welcome", "wallet");
    const repeated = completeOnboardingStep(wallet, "welcome", "wallet");
    expect(repeated.completedSteps).toEqual(["welcome"]);
  });

  it("stores only the action label and confirmed public hash", () => {
    const progress = recordConfirmedOnboardingAction(
      { ...createOnboardingProgress(), role: "supporter", step: "action" },
      { action: "Cast signal", transactionHash: "A".repeat(64) },
    );
    expect(progress.step).toBe("confirmation");
    expect(progress.confirmedAction).toEqual({ action: "Cast signal", transactionHash: "a".repeat(64) });
    expect(JSON.stringify(progress)).not.toMatch(/email|name/i);
  });

  it("resets corrupt and future-version records safely", () => {
    expect(parseOnboardingProgress({ schemaVersion: 2, step: "feedback", role: "supporter", completedSteps: [] })).toEqual(createOnboardingProgress());
    expect(loadOnboardingProgress(memoryStorage("not json"))).toEqual(createOnboardingProgress());
  });

  it("round-trips valid progress through a storage port", () => {
    const storage = memoryStorage();
    const expected = { ...createOnboardingProgress(), role: "reviewer" as const, step: "wallet" as const };
    saveOnboardingProgress(storage, expected);
    expect(loadOnboardingProgress(storage)).toEqual(expected);
  });
});
