// Entry point of the web UI. Bundled for the browser by src/ui.ts and served as /assets/app.js.
import "./styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/shell/app-shell";
import { TooltipProvider } from "./components/ui";
import { queryClient, useSummary } from "./lib/api";
import { useLiveUpdates } from "./lib/live";
import { useRoute } from "./lib/router";
import { PAGE_COMPONENTS } from "./pages";

function Routes() {
  const { page } = useRoute();
  const { data: s } = useSummary();
  useLiveUpdates();
  // The tab title counts what waits on the user.
  useEffect(() => {
    const waiting = s ? s.attention.total : 0;
    document.title = `${waiting ? `(${waiting}) ` : ""}Auto Apply`;
  }, [s]);
  const Current = PAGE_COMPONENTS[page];
  return <Current />;
}

const root = document.getElementById("root");
if (!root) throw new Error("the page has no #root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppShell>
          <Routes />
        </AppShell>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
