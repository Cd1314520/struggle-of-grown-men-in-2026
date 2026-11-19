// Early outreach: today's short emails to the people who hire at companies with a fresh hiring post, a
// new listing or a seed round. The app never sends anything: the owner copies a draft into his own mail,
// sends it, and marks it here (src/outreach-leads-api.ts, docs/outreach.md).
import { Check, Copy, ExternalLink, Mail, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { OutreachItem, OutreachState } from "../../../src/api-types";
import {
  Button,
  Callout,
  CompanyMark,
  EmptyState,
  ListBody,
  ListRow,
  Select,
  SkeletonRows,
  Workspace,
  WorkspaceSection,
  WorkspaceStrip,
} from "../../components/ui";
import { api, refreshAll, useOutreach } from "../../lib/api";

const STAGES = [
  ["drafted", "Drafted"],
  ["sent", "Sent"],
  ["followed_up", "Followed up"],
  ["replied", "Replied"],
  ["no_response", "No response"],
  ["closed", "Closed"],
] as const;
type Stage = (typeof STAGES)[number][0];
const stageLabel = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? s;
const KIND = { post: "Hiring post", listing: "New listing", seed: "Seed round" } as const;

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy: select the text and copy it by hand");
  }
}

const age = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

function Panel({ item, followUp }: { item: OutreachItem; followUp: boolean }) {
  const { person: p, lead } = item;
  const change = async (body: Record<string, unknown>) => {
    await api.changeOutreachPerson(p.id, body);
    void refreshAll();
  };
  const text = followUp && p.followup_body ? p.followup_body : `Subject: ${p.subject}\n\n${p.body}`;
  return (
    <div className="space-y-3 pb-4">
      <p className="text-sm text-fg-muted">
        {lead.what_they_do} {lead.why_fit && <span className="text-fg">Fit: {lead.why_fit}</span>}
      </p>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1 text-sm font-medium text-fg">
            {followUp ? "Follow-up (reply to your first email)" : "Email"} to {p.email}
          </span>
          <Button size="sm" icon={<Copy />} onClick={() => void copy(p.email, "Address")}>
            Copy address
          </Button>
          <Button size="sm" icon={<Copy />} onClick={() => void copy(followUp && p.followup_body ? p.followup_body : `${p.subject}\n\n${p.body}`, "Email")}>
            Copy email
          </Button>
        </div>
        <pre className="rounded-md border border-border bg-subtle p-3 font-sans text-sm whitespace-pre-wrap text-fg">
          {followUp && !p.followup_body ? "The follow-up is drafted once a day; it will appear here." : text}
        </pre>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {p.stage === "drafted" && (
          <Button size="sm" variant="primary" icon={<Check />} onClick={() => void change({ stage: "sent" })}>
            Mark sent
          </Button>
        )}
        {followUp && (
          <Button size="sm" variant="primary" icon={<Check />} onClick={() => void change({ stage: "followed_up" })}>
            Mark follow-up sent
          </Button>
        )}
        {p.email_confidence === "low" && !p.promoted && (
          <Button size="sm" icon={<Check />} onClick={() => void change({ promote: true })}>
            Address checked
          </Button>
        )}
        <Select<Stage>
          aria-label="Where this person stands"
          prefix="Stage"
          value={p.stage}
          options={STAGES.map(([value, label]) => ({ value, label }))}
          onValueChange={stage => void change({ stage })}
        />
        <Button size="sm" variant="ghost" icon={<ExternalLink />} asChild>
          <a href={lead.source_url} target="_blank" rel="noreferrer">
            Source
          </a>
        </Button>
        {p.profile_url && (
          <Button size="sm" variant="ghost" icon={<ExternalLink />} asChild>
            <a href={p.profile_url} target="_blank" rel="noreferrer">
              About {p.name.split(" ")[0]}
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 />}
          onClick={() =>
            void api.dropOutreachLead(lead.id).then(() => {
              toast.success(`${lead.company} dropped`);
              void refreshAll();
            })
          }
        >
          Drop {lead.company}
        </Button>
      </div>
    </div>
  );
}

function Row({ item, open, onToggle, followUp = false }: { item: OutreachItem; open: boolean; onToggle: () => void; followUp?: boolean }) {
  const { person: p, lead } = item;
  const likes = lead.kind === "post" ? (lead.likes === null ? ", likes unknown" : `, ${lead.likes} likes`) : "";
  const address = `${p.email} (${p.email_source}${p.email_confidence === "high" ? "" : `, ${p.email_confidence}`})`;
  return (
    <div>
      <ListRow
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={e => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          onToggle();
        }}
        className="cursor-pointer hover:bg-subtle"
        selected={open}
        lead={<CompanyMark name={lead.company} />}
        title={`${p.name}, ${p.role}`}
        secondary={<span>{`${lead.company} · ${KIND[lead.kind]}, ${age(lead.posted_at)}${likes}`}</span>}
        gist={address}
        fact={stageLabel(p.stage)}
      />
      {open && (
        <div className="border-b border-border px-(--list-x) pt-3">
          <Panel item={item} followUp={followUp} />
        </div>
      )}
    </div>
  );
}

function Section({ title, items, followUp, empty }: { title: string; items: OutreachItem[]; followUp?: boolean; empty?: string }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!items.length && !empty) return null;
  return (
    <WorkspaceSection title={title} count={items.length} flush>
      {items.length ? (
        <ListBody label={title}>
          {items.map(item => (
            <Row
              key={item.person.id}
              item={item}
              followUp={followUp ?? false}
              open={openId === item.person.id}
              onToggle={() => {
                setOpenId(o => (o === item.person.id ? null : item.person.id));
              }}
            />
          ))}
        </ListBody>
      ) : (
        <EmptyState
          icon={<Check />}
          title={empty ?? ""}
          description="The scout looks for more every few hours while fewer drafts wait than today has room for."
        />
      )}
    </WorkspaceSection>
  );
}

function Notes({ state }: { state: OutreachState }) {
  return (
    <div className="space-y-3 px-(--list-x) pt-4 empty:hidden">
      {!state.sendFrom && (
        <Callout tone="warning" title="Set the address you send from">
          Add <code>outreach: {"{ sendFrom: you@school.edu }"}</code> to config.local.yml so drafts are signed for it.
        </Callout>
      )}
      {!state.gmail && (
        <Callout tone="accent" title="Replies are marked by hand">
          The app cannot read the mailbox you send from, so set a person to Replied when they write back.
        </Callout>
      )}
    </div>
  );
}

export function OutreachPage() {
  const { data: state, isLoading } = useOutreach();
  const [busy, setBusy] = useState<"run" | "mail" | null>(null);
  const all = state ? [state.today, state.followUps, state.checkFirst, state.waiting, state.replied, state.done].flat() : [];
  return (
    <Workspace
      loading={isLoading}
      bar={{
        title: "Early outreach",
        count: all.length,
        noun: "people",
        hint: "Nothing here sends an email: copy a draft into your own mail, send it, then mark it sent.",
        actions: (
          <>
            {state?.gmail && (
              <Button
                size="sm"
                icon={<Mail />}
                loading={busy === "mail"}
                onClick={() => {
                  setBusy("mail");
                  void api
                    .checkOutreachMail()
                    .then(r => {
                      toast.success(`${r.checked} checked, ${r.replied} replied`);
                      void refreshAll();
                    })
                    .finally(() => {
                      setBusy(null);
                    });
                }}
              >
                Check mail
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              icon={<Search />}
              loading={busy === "run"}
              onClick={() => {
                setBusy("run");
                void api
                  .runOutreach()
                  .then(() => toast.success("The scout is looking for leads; drafts appear here as it finds them"))
                  .finally(() => {
                    setBusy(null);
                  });
              }}
            >
              Find leads now
            </Button>
          </>
        ),
      }}
      strip={
        state && (
          <WorkspaceStrip
            items={[
              { label: "Sent today", value: `${state.sentToday} of ${state.perDay}` },
              { label: "Follow-ups due", value: state.followUps.length },
              { label: "Replied", value: state.replied.length },
              { label: "Send from", value: state.sendFrom ?? "not set" },
            ]}
          />
        )
      }
    >
      {!state ? (
        <SkeletonRows />
      ) : (
        <>
          <Notes state={state} />
          <Section title="Today's emails" items={state.today} empty="No drafts waiting" />
          <Section title="Follow-ups due" items={state.followUps} followUp />
          <Section title="Check this address first" items={state.checkFirst} />
          <Section title="Waiting" items={state.waiting} />
          <Section title="Replied" items={state.replied} />
          <Section title="Done" items={state.done} />
        </>
      )}
    </Workspace>
  );
}
