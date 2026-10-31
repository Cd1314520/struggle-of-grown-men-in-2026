// Referrals: who to contact today, and every conversation with its next step and drafts to copy. The app
// never sends a message and never opens LinkedIn: the owner copies a draft, sends it from their own
// browser or mail, and marks where the contact stands (src/outreach.ts).
import { Check, Copy, ExternalLink, Mail, Plus, Trash2, Upload, UserPlus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ReferralContact, ReferralsState } from "../../../src/api-types";
import {
  Button,
  Callout,
  CompanyMark,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Disclosure,
  EmptyState,
  Field,
  Input,
  ListBody,
  ListRow,
  Select,
  SkeletonRows,
  Textarea,
  Workspace,
  WorkspaceSection,
  WorkspaceStrip,
} from "../../components/ui";
import { api, refreshAll, useReferrals } from "../../lib/api";
import { href } from "../../lib/router";

const STAGES = [
  ["drafted", "Drafted"],
  ["requested", "Invite sent"],
  ["connected", "Connected"],
  ["messaged", "Messaged"],
  ["followed_up", "Followed up"],
  ["replied", "Replied"],
  ["referred", "Referred"],
  ["declined", "Declined"],
  ["no_response", "No response"],
  ["closed", "Closed"],
] as const;
type Stage = (typeof STAGES)[number][0];
const stageLabel = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? s;
const RELATIONS = ["engineer", "manager", "alumni", "recruiter", "connection"] as const;
type Relation = (typeof RELATIONS)[number];

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy: select the text and copy it by hand");
  }
}

// One draft: its text as it will be sent, and a button that copies it.
function Draft({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium text-fg">{label}</span>
        <span className="tabular text-xs text-fg-subtle">{text.length} characters</span>
        <Button size="sm" icon={<Copy />} onClick={() => void copy(text, label)}>
          Copy
        </Button>
      </div>
      <pre className="rounded-md border border-border bg-subtle p-3 font-sans text-sm whitespace-pre-wrap text-fg">{text}</pre>
    </div>
  );
}

function ContactPanel({ c, state }: { c: ReferralContact; state: ReferralsState }) {
  const [notes, setNotes] = useState(c.notes);
  const [email, setEmail] = useState(c.email ?? "");
  const [removing, setRemoving] = useState(false);
  const change = async (body: Record<string, unknown>) => {
    await api.changeContact(c.id, body);
    void refreshAll();
  };
  const d = c.drafts;
  return (
    <div className="space-y-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select<Stage>
          aria-label="Where this contact stands"
          prefix="Stage"
          value={c.stage}
          options={STAGES.map(([value, label]) => ({ value, label }))}
          onValueChange={stage => void change({ op: "stage", stage, withNote: stage === "requested" && !!d?.note })}
        />
        {state.areas.length > 1 && (
          <Select
            aria-label="Facts the drafts use"
            prefix="Facts"
            value={c.area ?? ""}
            options={[{ value: "", label: "From the job" }, ...state.areas.map(a => ({ value: a, label: a }))]}
            onValueChange={area => void change({ op: "edit", area })}
          />
        )}
        {c.profile_url && (
          <Button size="sm" variant="ghost" icon={<ExternalLink />} asChild>
            <a href={c.profile_url} target="_blank" rel="noreferrer">
              Profile
            </a>
          </Button>
        )}
        {c.job && (
          <Button size="sm" variant="ghost" asChild>
            <a href={href("job", c.job.id)}>{c.job.title}</a>
          </Button>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="danger-ghost"
          icon={<Trash2 />}
          onClick={() => {
            setRemoving(true);
          }}
        >
          Remove
        </Button>
      </div>
      {d ? (
        <div className="space-y-4">
          <Draft label="Invite note" text={d.note} />
          <Draft label="Message" text={d.message} />
          <Draft label="Follow-up" text={d.followup} />
          {d.email && <Draft label="Email" text={`Subject: ${d.email.subject}\n\n${d.email.body}`} />}
          <Disclosure summary="If they say yes, and after the referral">
            <div className="space-y-4 pt-2">
              <Draft label="Referral packet" text={d.packet} />
              <Draft label="Thank-you" text={d.thanks} />
            </div>
          </Disclosure>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Drafts appear once profile/referral.yml is filled in.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (for an email draft)">
          <Input
            value={email}
            onChange={e => {
              setEmail(e.target.value);
            }}
            onBlur={() => email !== (c.email ?? "") && void change({ op: "edit", email })}
          />
        </Field>
        <Field label="Notes">
          <Textarea
            rows={2}
            value={notes}
            onChange={e => {
              setNotes(e.target.value);
            }}
            onBlur={() => notes !== c.notes && void change({ op: "edit", notes })}
          />
        </Field>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${c.name}?`}
        description="Their stage and dates are deleted. Nothing was ever sent from here."
        confirm="Remove"
        danger
        onConfirm={() => void change({ op: "remove" })}
      />
    </div>
  );
}

function ContactRow({ c, state, open, onToggle }: { c: ReferralContact; state: ReferralsState; open: boolean; onToggle: () => void }) {
  const overdue = state.due.find(x => x.contactId === c.id)?.overdue;
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
        lead={<CompanyMark name={c.company} />}
        title={`${c.name}${c.title ? `, ${c.title}` : ""}`}
        secondary={<span>{c.company}</span>}
        gist={c.next.what}
        fact={overdue ? "Overdue" : stageLabel(c.stage)}
      />
      {open && (
        <div className="border-b border-border px-(--list-x) pt-3">
          <ContactPanel c={c} state={state} />
        </div>
      )}
    </div>
  );
}

function AddContact({
  open,
  onOpenChange,
  seed,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  seed: Partial<Record<string, string | number | null>>;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [relation, setRelation] = useState<Relation>("engineer");
  const [saving, setSaving] = useState(false);
  const value = (k: string) => form[k] ?? (seed[k] == null ? "" : String(seed[k]));
  const set = (k: string) => (e: { target: { value: string } }) => {
    setForm(f => ({ ...f, [k]: e.target.value }));
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.addContact({
        name: value("name"),
        company: value("company"),
        title: value("title"),
        profileUrl: value("profileUrl"),
        email: value("email"),
        relation: form["relation"] ?? seed["relation"] ?? relation,
        jobId: seed["jobId"] ?? null,
      });
      void refreshAll();
      setForm({});
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a contact"
        description="Someone you found on LinkedIn or elsewhere. Their drafts are built from profile/referral.yml."
        footer={
          <Button variant="primary" loading={saving} disabled={!value("name") || !value("company")} onClick={() => void save()}>
            Add
          </Button>
        }
      >
        <div className="grid gap-3 p-4">
          <Field label="Name">
            <Input autoFocus value={value("name")} onChange={set("name")} />
          </Field>
          <Field label="Company">
            <Input value={value("company")} onChange={set("company")} />
          </Field>
          <Field label="Their title">
            <Input value={value("title")} onChange={set("title")} />
          </Field>
          <Field label="Who they are to you">
            <Select<Relation>
              aria-label="Relation"
              value={(form["relation"] as Relation | undefined) ?? (seed["relation"] as Relation | undefined) ?? relation}
              options={RELATIONS.map(r => ({ value: r, label: `${r.charAt(0).toUpperCase()}${r.slice(1)}` }))}
              onValueChange={r => {
                setRelation(r);
                setForm(f => ({ ...f, relation: r }));
              }}
            />
          </Field>
          <Field label="LinkedIn profile URL">
            <Input value={value("profileUrl")} onChange={set("profileUrl")} placeholder="https://www.linkedin.com/in/…" />
          </Field>
          <Field label="Email (optional)">
            <Input value={value("email")} onChange={set("email")} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// The LinkedIn export the owner downloaded: a zip, or Connections.csv on its own.
function UploadExport() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,.csv"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          void api
            .importLinkedInExport(file)
            .then(r => {
              toast.success(`${r.connections === null ? "No connections file" : `${r.connections} connections`}, ${r.updates} contact update(s)`);
              void refreshAll();
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      />
      <Button size="sm" icon={<Upload />} loading={busy} onClick={() => input.current?.click()}>
        Upload LinkedIn export
      </Button>
    </>
  );
}

function Today({ state, onAdd }: { state: ReferralsState; onAdd: (seed: Record<string, string | number | null>) => void }) {
  if (!state.people.length && !state.companies.length) return null;
  return (
    <WorkspaceSection title="Who to contact today" description="People you already know at employers you are applying to, then employers worth a cold message.">
      <div className="space-y-5">
        {state.people.length > 0 && (
          <ListBody label="People you know">
            {state.people.map(p => (
              <ListRow
                key={p.key}
                lead={<CompanyMark name={p.company} />}
                title={`${p.name}, ${p.position}`}
                secondary={<span>{p.company}</span>}
                gist={p.why}
                actions={
                  <>
                    {p.url && (
                      <Button size="icon-sm" variant="ghost" aria-label="Open their profile in your browser" asChild>
                        <a href={p.url} target="_blank" rel="noreferrer">
                          <ExternalLink />
                        </a>
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Add as a contact"
                      onClick={() => {
                        onAdd({ name: p.name, company: p.company, title: p.position, profileUrl: p.url, relation: "connection", jobId: p.jobId });
                      }}
                    >
                      <UserPlus />
                    </Button>
                  </>
                }
              />
            ))}
          </ListBody>
        )}
        {state.companies.map(co => (
          <div key={co.key} className="space-y-2 border-b border-border pb-4 last:border-b-0">
            <div className="flex flex-wrap items-center gap-2">
              <CompanyMark name={co.company} size="sm" />
              <span className="font-medium text-fg">{co.company}</span>
              {co.place && <span className="text-sm text-fg-muted">{co.place}</span>}
              <span className="flex-1" />
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() => {
                  onAdd({ company: co.company, jobId: co.job?.id ?? null });
                }}
              >
                Add contact
              </Button>
            </div>
            <p className="text-sm text-fg-muted">
              {co.why}
              {co.job && (
                <>
                  {" "}
                  <a className="text-accent-text hover:underline" href={href("job", co.job.id)}>
                    {co.job.title}
                  </a>
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {co.links.map(l => (
                <a key={l.url} className="text-accent-text hover:underline" href={l.url} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ))}
              {co.careers && (
                <a className="text-accent-text hover:underline" href={co.careers} target="_blank" rel="noreferrer">
                  Careers page
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </WorkspaceSection>
  );
}

export function ReferralsPage() {
  const { data: state, isLoading } = useReferrals();
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState<Record<string, string | number | null> | null>(null);
  const [checking, setChecking] = useState(false);
  const due = new Set(state?.due.map(d => d.contactId));
  const contacts = state?.contacts ?? [];
  const dueContacts = contacts.filter(c => due.has(c.id));
  const rest = contacts.filter(c => !due.has(c.id));
  const row = (c: ReferralContact) =>
    state && (
      <ContactRow
        key={c.id}
        c={c}
        state={state}
        open={openId === c.id}
        onToggle={() => {
          setOpenId(o => (o === c.id ? null : c.id));
        }}
      />
    );
  return (
    <Workspace
      loading={isLoading}
      bar={{
        title: "Referrals",
        count: contacts.length,
        noun: "contacts",
        hint: "Nothing here sends a message or opens LinkedIn: copy a draft, send it yourself, then mark where the contact stands.",
        actions: (
          <>
            {state?.mail.connected && (
              <Button
                size="sm"
                icon={<Mail />}
                loading={checking}
                onClick={() => {
                  setChecking(true);
                  void api
                    .checkReferralMail()
                    .then(r => {
                      toast.success(`${r.checked} contact(s) checked, ${r.updates} update(s)`);
                      void refreshAll();
                    })
                    .finally(() => {
                      setChecking(false);
                    });
                }}
              >
                Check mail
              </Button>
            )}
            <UploadExport />
            <Button
              size="sm"
              variant="primary"
              icon={<Plus />}
              onClick={() => {
                setAdding({});
              }}
            >
              Add contact
            </Button>
          </>
        ),
      }}
      strip={
        state && (
          <WorkspaceStrip
            items={[
              { label: "Due", value: state.due.length },
              { label: "Invite notes left", value: `${state.notes.left} of ${state.notes.perMonth}`, hint: `${state.notes.limit} characters each` },
              {
                label: "Connections",
                value: state.linkedin.connections.toLocaleString(),
                hint: state.linkedin.lastExportOn ? `export of ${state.linkedin.lastExportOn}` : "no export yet",
              },
            ]}
          />
        )
      }
    >
      {!state ? (
        <SkeletonRows />
      ) : (
        <>
          <div className="space-y-3 px-(--list-x) pt-4 empty:hidden">
            {state.problems.length > 0 && (
              <Callout tone="warning" title="profile/referral.yml needs filling in before drafts appear">
                <ul className="list-disc pl-5">
                  {state.problems.map(p => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <a className="text-accent-text hover:underline" href={href("profile", "referral.yml")}>
                  Open it in Profile
                </a>
              </Callout>
            )}
            {state.linkedin.due && (
              <Callout
                tone="accent"
                title={state.linkedin.lastExportOn ? "Time for a fresh LinkedIn export" : "Upload your LinkedIn export"}
                action={
                  <Button size="sm" variant="ghost" icon={<ExternalLink />} asChild>
                    <a href={state.linkedin.exportUrl} target="_blank" rel="noreferrer">
                      Request it on LinkedIn
                    </a>
                  </Button>
                }
              >
                Request a copy of your data (Connections, Invitations and Messages) in your own browser, then upload the zip here. It shows who you know where,
                and moves contacts on when they accept or reply.
              </Callout>
            )}
          </div>
          {dueContacts.length > 0 && (
            <WorkspaceSection title="Next steps due" count={dueContacts.length} flush>
              <ListBody label="Contacts">{dueContacts.map(row)}</ListBody>
            </WorkspaceSection>
          )}
          <Today
            state={state}
            onAdd={seed => {
              setAdding(seed);
            }}
          />
          <WorkspaceSection title="Contacts" count={rest.length} flush>
            {rest.length ? (
              <ListBody label="Contacts">{rest.map(row)}</ListBody>
            ) : (
              <EmptyState icon={<Check />} title="No other contacts" description="Add someone from today's list, or anyone you find yourself." />
            )}
          </WorkspaceSection>
        </>
      )}
      <AddContact
        open={adding !== null}
        onOpenChange={o => {
          if (!o) setAdding(null);
        }}
        seed={adding ?? {}}
      />
    </Workspace>
  );
}
