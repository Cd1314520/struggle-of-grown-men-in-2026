import { useSettings } from "../../lib/api";
import { ConfigRow, type FieldKind } from "./field";
import { SavedLocally, SettingsGroup, SettingsPanel } from "./parts";

const minutes = { kind: "number", unit: "min" } as const;
const perDay = { kind: "number", unit: "a day" } as const;
const port = { kind: "number", min: 1 } as const;

export function Schedule() {
  return (
    <SettingsPanel
      id="schedule"
      title="Schedule & limits"
      description="When the app runs on its own and how much it may do in a day. Daily caps reset at midnight UTC."
      footer={<SavedLocally />}
    >
      <SettingsGroup title="Runs" />
      <ConfigRow
        path="schedule.scanMinutes"
        label="Scan every"
        description="Re-reads every watched board and feed. Only new postings cost anything. 0 runs it only from the button."
        field={minutes}
      />
      <ConfigRow
        path="schedule.discoverMinutes"
        label="Discover every"
        description="An agent searches the web for more companies and postings to watch. 0 turns it off."
        field={minutes}
      />
      <ConfigRow
        path="schedule.trackMinutes"
        label="Read mail every"
        description="Reads the mailbox for replies to applications. 0 turns it off."
        field={minutes}
      />
      <SettingsGroup title="Daily caps" />
      <ConfigRow path="limits.prepPerDay" label="Assessments" field={perDay} />
      <ConfigRow
        path="limits.locatePerDay"
        label="Posting look-ups"
        description="LinkedIn and Indeed postings handed to the web-search agent."
        field={perDay}
      />
      <ConfigRow
        path="limits.applyPerDay"
        label="New applications"
        description="Blocked and failed starts count; resuming one already started doesn't."
        field={perDay}
      />
      <ConfigRow
        path="limits.applySpreadHours"
        label="Spread new applications over"
        description="New applications start at most one per this many hours divided by the daily cap. Postings opened in the last day skip the wait. 0 starts them as fast as browsers allow."
        field={{ kind: "number", step: 0.5, unit: "hours" }}
      />
      <SettingsGroup title="At once" />
      <ConfigRow path="concurrency.prep" label="Assessments at once" field={{ kind: "number" }} />
      <ConfigRow
        path="concurrency.fill"
        label="Applications at once"
        description="Each runs in its own Chrome, with its own display, profile and ports."
        field={{ kind: "number", min: 1 }}
      />
      <SettingsGroup title="Records" />
      <ConfigRow
        path="retention.chatterDays"
        label="Keep agents' step-by-step records"
        description="Each step, tool call and message. 0 keeps them for good. Approvals, gates, errors, mail and your own actions are never removed."
        field={{ kind: "number", unit: "days" }}
      />
    </SettingsPanel>
  );
}

const paramField = (value: unknown): FieldKind =>
  Array.isArray(value) ? { kind: "list" } : typeof value === "number" ? { kind: "number" } : typeof value === "boolean" ? { kind: "bool" } : { kind: "text" };
const titled = (key: string) =>
  key.charAt(0).toUpperCase() +
  key
    .slice(1)
    .replace(/([A-Z])/g, " $1")
    .toLowerCase();
const FEED_NAMES: Record<string, string> = { remotive: "Remotive", jobicy: "Jobicy", remoteok: "RemoteOK" };

export function Sources() {
  const { data } = useSettings();
  const feeds = (data?.values["feeds"] ?? {}) as Record<string, Record<string, unknown>>;
  return (
    <SettingsPanel
      id="sources"
      title="Sources"
      description="Where scans read postings beyond the watched company boards. Each is read no more often than its own minutes; 0 turns it off."
      footer={<SavedLocally />}
    >
      <SettingsGroup title="LinkedIn and Indeed" />
      <ConfigRow
        path="boards.queries"
        label="Searches"
        description="Each search is read logged out, newest first. A posting that passes triage is applied to on the employer's own site."
        field={{ kind: "list", placeholder: "software engineer, AI engineer" }}
      />
      <ConfigRow path="boards.location" label="Location" field={{ kind: "text", placeholder: "United States" }} />
      <ConfigRow path="boards.distance" label="Distance" field={{ kind: "number", unit: "miles" }} />
      <ConfigRow
        path="boards.initialHours"
        label="First scan looks back"
        description="Later scans ask only for what is new since the last."
        field={{ kind: "number", unit: "hours" }}
      />
      <ConfigRow
        path="boards.linkedin.minutes"
        label="LinkedIn every"
        description="Neither site permits automated reading, so requests are kept few; a refusal pauses that site for 6 hours."
        field={minutes}
      />
      <ConfigRow path="boards.linkedin.pages" label="LinkedIn pages per search" description="10 postings a page." field={{ kind: "number", min: 1 }} />
      <ConfigRow path="boards.indeed.minutes" label="Indeed every" description="One request per search, up to 100 postings each." field={minutes} />
      {Object.entries(feeds).map(([name, feed]) => (
        <FeedRows key={name} name={name} feed={feed} />
      ))}
    </SettingsPanel>
  );
}

function FeedRows({ name, feed }: { name: string; feed: Record<string, unknown> }) {
  const label = FEED_NAMES[name] ?? titled(name);
  return (
    <>
      <SettingsGroup title={label} />
      <ConfigRow path={`feeds.${name}.minutes`} label={`${label} every`} field={minutes} />
      {Object.entries(feed)
        .filter(([key]) => key !== "minutes")
        .map(([key, value]) => (
          <ConfigRow key={key} path={`feeds.${name}.${key}`} label={titled(key)} field={paramField(value)} />
        ))}
    </>
  );
}

export function Server() {
  return (
    <SettingsPanel id="server" title="Server" description="Where the app is reached, and the resume project it compiles." footer={<SavedLocally />}>
      <SettingsGroup title="Addresses" />
      <ConfigRow
        path="publicUrl"
        label="Public address"
        description="How you reach the app from elsewhere (a tailnet address, say). The app refuses requests to names it doesn't know, and the Gmail sign-in returns here. Empty: http://localhost and the port."
        field={{ kind: "text", type: "url", nullable: true, mono: true, placeholder: "https://…" }}
      />
      <ConfigRow
        path="vncUrl"
        label="Live view address"
        description="How you reach the browsers' live view. Empty: http://localhost and the VNC port."
        field={{ kind: "text", type: "url", nullable: true, mono: true, placeholder: "https://…" }}
      />
      <ConfigRow path="port" label="Port" description="The public address must still lead here." field={port} />
      <SettingsGroup title="Resume" />
      <ConfigRow path="resume.dir" label="Project folder" description="The Typst project, from the app's folder." field={{ kind: "text", mono: true }} />
      <ConfigRow
        path="resume.main"
        label="Content file"
        description="The file the agent tailors. The project's other .typ files are the template and are never edited."
        field={{ kind: "text", mono: true }}
      />
      <ConfigRow
        path="resume.pdfName"
        label="PDF name"
        description="Every compiled resume is given this name, so it is the name employers see on the upload."
        field={{ kind: "text", mono: true }}
      />
    </SettingsPanel>
  );
}

export function BrowserRows() {
  return (
    <>
      <ConfigRow
        path="fillPauseSeconds"
        label="Rest between applications"
        description="Randomised within the range. Applications in different browsers also start at least the lower number apart."
        field={{ kind: "pair", unit: "s" }}
      />
      <ConfigRow path="chrome.window" label="Window size" description="Width and height, in pixels." field={{ kind: "pair", min: 1, unit: "px" }} />
      <ConfigRow
        path="chrome.display"
        label="X display"
        description="Further browsers count up from it."
        field={{ kind: "text", mono: true, short: true, placeholder: ":99" }}
      />
      <ConfigRow path="chrome.cdpPort" label="DevTools port" description="Further browsers count up from it, two at a time." field={port} />
      <ConfigRow
        path="chrome.proxyPort"
        label="Agent port"
        description="Agents connect here: the same browser, with input paced like a person's."
        field={port}
      />
      <ConfigRow
        path="chrome.vncPort"
        label="Live view port"
        description="noVNC for taking over a browser (localhost only). 0 turns the live view off."
        field={{ kind: "number" }}
      />
    </>
  );
}
