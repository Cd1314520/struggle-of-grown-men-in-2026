// The server says when anything changed over /api/stream; every query on screen is then refetched.
// The stream doubles as the connection check: while it is down, the page says so.
import { useEffect, useSyncExternalStore } from "react";
import { refreshAll } from "./api";

let online = true;
const listeners = new Set<() => void>();
const setOnline = (on: boolean) => {
  if (on === online) return;
  online = on;
  for (const l of listeners) l();
};
export const useOnline = () =>
  useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => online,
  );

export function useLiveUpdates() {
  useEffect(() => {
    const stream = new EventSource("/api/stream");
    let timer: ReturnType<typeof setTimeout> | undefined;
    stream.onmessage = () => {
      // Bursts of changes (a worker's steps) refetch once.
      clearTimeout(timer);
      timer = setTimeout(() => void refreshAll(), 250);
    };
    stream.onerror = () => {
      setOnline(false);
    };
    stream.onopen = () => {
      if (!online) void refreshAll();
      setOnline(true);
    };
    return () => {
      clearTimeout(timer);
      stream.close();
    };
  }, []);
}
