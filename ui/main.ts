// Entry point of the web UI. Bundled for the browser by src/ui.ts and served as /app.js.
import { loadState } from "./api";
import { listen } from "./events";
import { refresh, route } from "./router";
import { setState } from "./store";
import { shell } from "./util";

listen();
addEventListener("hashchange", () => void route());

// The stream doubles as the connection check: while it is down, say so instead of showing stale state as current.
const stream = new EventSource("/api/stream");
const offline = (on: boolean) => {
  shell("offline").hidden = !on;
};
stream.onmessage = () => void refresh();
stream.onerror = () => {
  offline(true);
};
stream.onopen = () => {
  if (shell("offline").hidden) return;
  offline(false);
  void refresh();
};
loadState().then(
  s => {
    setState(s);
    void route();
  },
  () => {
    offline(true);
  },
);
