// The Settings sheet, open from the remote and from the Connect screen alike (the app keeps one).
import { useSyncExternalStore } from "react";

let open = false;
const subscribers = new Set<() => void>();

const notify = () => subscribers.forEach((f) => f());

export function openSettings() {
  if (open) return;
  open = true;
  notify();
}

export function closeSettings() {
  if (!open) return;
  open = false;
  notify();
}

export function useSettingsOpen(): boolean {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => open,
  );
}
