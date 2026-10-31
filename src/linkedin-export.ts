// Reading a LinkedIn data export the owner downloaded themselves (Settings > Data privacy > Get a copy of
// your data) and uploaded on the Referrals page. Nothing here goes near linkedin.com.
//
// The export is a zip of CSV files, or one of those files on its own:
//   Connections.csv   the owner's first-degree network: who works where (the daily list's "people you
//                     know"), and which contacts accepted an invite (connected)
//   Invitations.csv   invites the owner sent (requested; with a note, when it carried a message)
//   messages.csv      messages both ways: the owner's first to a contact (messaged), a second
//                     (followed_up), and theirs back (replied)
// Pure: tested on fixtures without a database.
import { inflateRawSync } from "node:zlib";
import { personKey, profileId, type Contact, type Stage } from "./referrals";

// ---- zip: the central directory, stored and deflated entries. Enough for LinkedIn's exports.

export function unzip(bytes: Uint8Array, want: (name: string) => boolean = () => true): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: the last PK\5\6 within the final 64 KiB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("not a zip file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("the zip's directory is damaged");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true),
      extraLength = view.getUint16(at + 30, true),
      commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || !want(name)) continue;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`the zip entry ${name} is damaged`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`the zip entry ${name} uses a compression this cannot read (${method})`);
  }
  return out;
}

export const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;

// ---- CSV, as RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// The rows under the first line that names `header` (LinkedIn puts a "Notes:" preamble above some
// tables), keyed by the lower-cased column names.
export function csvTable(text: string, header: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const want = header.toLowerCase();
  const start = rows.findIndex(r => r.some(c => c.trim().toLowerCase() === want));
  if (start < 0) return [];
  const names = (rows[start] ?? []).map(c => c.trim().toLowerCase());
  return rows
    .slice(start + 1)
    .filter(r => r.some(c => c.trim()))
    .map(r => Object.fromEntries(names.map((n, i) => [n, (r[i] ?? "").trim()])));
}

// LinkedIn's dates come in several shapes: "23 Oct 2026", "10/24/26, 3:15 PM", "2026-10-24 15:15:00 UTC".
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseDay(raw: string): string {
  const s = raw.trim().replace(/\s*UTC$/, "");
  const pad = (n: number) => String(n).padStart(2, "0");
  let m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf((m[2] ?? "").toLowerCase());
    if (month >= 0) return `${m[3]}-${pad(month + 1)}-${pad(Number(m[1]))}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
  if (m) {
    const year = (m[3] ?? "").length === 2 ? `20${m[3]}` : (m[3] ?? "");
    return `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

export interface ExportConnection {
  name: string;
  url: string | null;
  company: string;
  position: string;
  connected_on: string | null;
}
export interface ExportInvitation {
  to: string;
  url: string;
  sentOn: string;
  withNote: boolean;
  outgoing: boolean;
}
export interface ExportMessage {
  from: string;
  fromUrl: string;
  to: string;
  toUrls: string[];
  on: string;
}
export interface LinkedInExport {
  connections: ExportConnection[] | null; // null: the upload had no Connections.csv
  invitations: ExportInvitation[];
  messages: ExportMessage[];
}

const TABLES = { connections: "connections.csv", invitations: "invitations.csv", messages: "messages.csv" } as const;

// Reads an upload: a zip (the export as downloaded) or one of its CSV files.
export function readExport(name: string, bytes: Uint8Array): LinkedInExport {
  const texts: Partial<Record<keyof typeof TABLES, string>> = {};
  const utf8 = new TextDecoder();
  if (isZip(bytes)) {
    const files = unzip(bytes, n => Object.values(TABLES).some(t => n.toLowerCase().endsWith(t)));
    for (const [file, data] of files)
      for (const [kind, suffix] of Object.entries(TABLES) as [keyof typeof TABLES, string][])
        if (file.toLowerCase().endsWith(suffix) && !texts[kind]) texts[kind] = utf8.decode(data);
  } else {
    const text = utf8.decode(bytes);
    // A CSV on its own is known by its columns, whatever it was renamed to.
    const head = text.slice(0, 4000).toLowerCase();
    const kind = head.includes("first name")
      ? "connections"
      : head.includes("inviteeprofileurl")
        ? "invitations"
        : head.includes("sender profile url")
          ? "messages"
          : null;
    if (!kind) throw new Error(`${name} is neither a LinkedIn export zip nor its Connections.csv, Invitations.csv or messages.csv`);
    texts[kind] = text;
  }
  if (!texts.connections && !texts.invitations && !texts.messages)
    throw new Error(
      `${name} holds no Connections.csv, Invitations.csv or messages.csv: request the export with Connections (and Messages and Invitations to sync conversations)`,
    );
  return {
    connections: texts.connections
      ? csvTable(texts.connections, "first name").map(r => ({
          name: `${r["first name"] ?? ""} ${r["last name"] ?? ""}`.trim(),
          url: r["url"] || null,
          company: r["company"] ?? "",
          position: r["position"] ?? "",
          connected_on: parseDay(r["connected on"] ?? "") || null,
        }))
      : null,
    invitations: texts.invitations
      ? csvTable(texts.invitations, "direction").map(r => ({
          to: r["to"] ?? "",
          url: r["inviteeprofileurl"] ?? "",
          sentOn: parseDay(r["sent at"] ?? ""),
          withNote: !!r["message"]?.trim(),
          outgoing: (r["direction"] ?? "").toUpperCase() === "OUTGOING",
        }))
      : [],
    messages: texts.messages
      ? csvTable(texts.messages, "sender profile url").map(r => ({
          from: r["from"] ?? "",
          fromUrl: r["sender profile url"] ?? "",
          to: r["to"] ?? "",
          toUrls: (r["recipient profile urls"] ?? "").split(/[,\s]+/).filter(Boolean),
          on: parseDay(r["date"] ?? ""),
        }))
      : [],
  };
}

export interface Bump {
  contactId: number;
  stage: Stage;
  day: string;
  withNote?: boolean;
}

// How the export moves the owner's contacts on. A contact is found by profile URL, else by name. The
// store applies each bump forward only, so what the export says never undoes what the owner recorded.
export function exportBumps(ex: LinkedInExport, contacts: readonly Pick<Contact, "id" | "name" | "profile_url">[]): Bump[] {
  const byUrl = new Map<string, number>(),
    byName = new Map<string, number>();
  for (const c of contacts) {
    const pid = profileId(c.profile_url);
    if (pid) byUrl.set(pid, c.id);
    byName.set(personKey(c.name), c.id);
  }
  const who = (url: string | null | undefined, name: string) => byUrl.get(profileId(url)) ?? byName.get(personKey(name));
  const bumps: Bump[] = [];
  for (const inv of ex.invitations) {
    if (!inv.outgoing) continue;
    const id = who(inv.url, inv.to);
    if (id !== undefined && inv.sentOn) bumps.push({ contactId: id, stage: "requested", day: inv.sentOn, withNote: inv.withNote });
  }
  for (const c of ex.connections ?? []) {
    const id = who(c.url, c.name);
    if (id !== undefined && c.connected_on) bumps.push({ contactId: id, stage: "connected", day: c.connected_on });
  }
  // A contact who wrote replied; a message to a contact from anyone else is the owner's: the first is the
  // message, a second the follow-up.
  const sent = new Map<number, number>();
  for (const m of [...ex.messages].sort((a, b) => a.on.localeCompare(b.on))) {
    if (!m.on) continue;
    const from = who(m.fromUrl, m.from);
    if (from !== undefined) {
      bumps.push({ contactId: from, stage: "replied", day: m.on });
      continue;
    }
    const names = m.to.split(",").map(s => s.trim());
    const ids = new Set<number>();
    m.toUrls.forEach((url, i) => {
      const id = who(url, names[i] ?? "");
      if (id !== undefined) ids.add(id);
    });
    if (!m.toUrls.length) for (const n of names) if (byName.has(personKey(n))) ids.add(byName.get(personKey(n)) ?? 0);
    for (const id of ids) {
      const n = (sent.get(id) ?? 0) + 1;
      sent.set(id, n);
      bumps.push({ contactId: id, stage: n === 1 ? "messaged" : "followed_up", day: m.on });
    }
  }
  return bumps;
}
