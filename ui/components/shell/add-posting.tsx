import { Link2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, refreshAll } from "../../lib/api";
import { navigate } from "../../lib/router";
import { Button, Callout, Dialog, DialogContent, Input } from "../ui";
import { useShell } from "./state";

export function AddPostingDialog() {
  const { addOpen, setAddOpen } = useShell();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState<number | null>(null);
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const close = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      setKnown(null);
      setError("");
    }
  };
  const submit = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    setKnown(null);
    setError("");
    try {
      const { id } = await api.addPosting(u);
      setUrl("");
      close(false);
      void refreshAll();
      toast.success("Posting added", {
        description: "It will be assessed shortly.",
        action: {
          label: "Open",
          onClick: () => {
            navigate(`pipeline/${id}`);
          },
        },
      });
    } catch (err) {
      const body = err instanceof ApiError && typeof err.body === "object" && err.body ? (err.body as { id?: unknown }) : {};
      if (err instanceof ApiError && err.status === 409 && typeof body.id === "number") setKnown(body.id);
      else setError(err instanceof Error ? err.message : "Could not add it.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={addOpen} onOpenChange={close}>
      <DialogContent
        onOpenAutoFocus={e => {
          e.preventDefault();
          field.current?.focus();
        }}
        title="Add a posting"
        description="Paste a job posting URL. It is assessed like any posting a scan finds."
        footer={
          <>
            <Button
              onClick={() => {
                close(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={busy} disabled={!url.trim()} onClick={() => void submit()}>
              Add posting
            </Button>
          </>
        }
      >
        <form
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="relative">
            <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
            <Input
              ref={field}
              id="addurl"
              inputMode="url"
              placeholder="https://boards.greenhouse.io/…"
              aria-label="Job URL"
              value={url}
              onChange={e => {
                setUrl(e.target.value);
              }}
              className="h-9 pl-8"
            />
          </div>
          {known !== null && (
            <Callout
              tone="neutral"
              title="Already tracked"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    close(false);
                    navigate(`job/${known}`);
                  }}
                >
                  Open job
                </Button>
              }
            >
              This posting is already in the app.
            </Callout>
          )}
          {error && <Callout tone="danger">{error.charAt(0).toUpperCase() + error.slice(1)}.</Callout>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
