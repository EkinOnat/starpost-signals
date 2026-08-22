import { useCallback, useEffect, useState } from "react";
import {
  completeOnboardingStep,
  createOnboardingProgress,
  loadOnboardingProgress,
  recordConfirmedOnboardingAction,
  saveOnboardingProgress,
  type OnboardingProgress,
  type OnboardingRole,
  type OnboardingStep,
} from "../domain/onboarding";

function initialProgress() {
  if (typeof window === "undefined") return createOnboardingProgress();
  return loadOnboardingProgress(window.localStorage);
}

export function useOnboarding() {
  const [progress, setProgress] = useState<OnboardingProgress>(initialProgress);

  useEffect(() => {
    saveOnboardingProgress(window.localStorage, progress);
  }, [progress]);

  const chooseRole = useCallback((role: OnboardingRole) => {
    setProgress((current) => ({ ...current, role }));
  }, []);

  const move = useCallback((current: OnboardingStep, next: OnboardingStep) => {
    setProgress((value) => completeOnboardingStep(value, current, next));
  }, []);

  const goBack = useCallback(() => {
    setProgress((current) => {
      const index = Math.max(0, ["welcome", "wallet", "testnet", "action", "confirmation", "feedback"].indexOf(current.step));
      const previous = ["welcome", "wallet", "testnet", "action", "confirmation", "feedback"][Math.max(0, index - 1)] as OnboardingStep;
      return { ...current, step: previous };
    });
  }, []);

  const recordConfirmation = useCallback((action: string, transactionHash: string) => {
    setProgress((current) => {
      if (current.confirmedAction?.transactionHash === transactionHash.toLowerCase()) return current;
      return recordConfirmedOnboardingAction(current, { action, transactionHash });
    });
  }, []);

  const restart = useCallback(() => setProgress(createOnboardingProgress()), []);

  return { progress, chooseRole, move, goBack, recordConfirmation, restart };
}
