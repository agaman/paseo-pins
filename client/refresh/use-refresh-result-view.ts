import { useEffect, useRef } from "react";
import { AppState } from "react-native";

// Observe viewing in the client; persist the decision before unmount/reload.
export function useRefreshResultView(enabled: boolean, acknowledge: () => Promise<boolean>) {
  const callback = useRef(acknowledge);
  callback.current = acknowledge;
  useEffect(() => {
    if (!enabled) return;
    let remaining = 3000;
    let since: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let sending = false;
    let saved = false;
    const pause = () => {
      clearTimeout(timer);
      if (since !== null) remaining = Math.max(0, remaining - (Date.now() - since));
      since = null;
    };
    const resume = () => {
      if (stopped || saved || sending || AppState.currentState !== "active") return;
      since = Date.now();
      timer = setTimeout(async () => {
        pause();
        sending = true;
        saved = await callback.current();
        sending = false;
        if (!saved) {
          remaining = 5000;
          resume();
        }
      }, remaining);
    };
    resume();
    const subscription = AppState.addEventListener("change", () => {
      pause();
      resume();
    });
    return () => {
      stopped = true;
      pause();
      subscription.remove();
    };
  }, [enabled]);
}
