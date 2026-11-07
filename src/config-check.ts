type Check = (value: unknown, path: string, problems: string[]) => void;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const show = (value: unknown) => (value === undefined ? "missing" : JSON.stringify(value));

const check =
  (ok: (value: unknown) => boolean, expected: string): Check =>
  (value, path, problems) => {
    if (!ok(value)) problems.push(`${path}: expected ${expected}, got ${show(value)}`);
  };
const text = check(v => typeof v === "string" && !!v.trim(), "non-empty text");
const words = check(v => typeof v === "string", "text");
const bool = check(v => typeof v === "boolean", "true or false");
const count = (min = 0) => check(v => typeof v === "number" && Number.isInteger(v) && v >= min, `a whole number of at least ${min}`);
const amount = (min = 0) => check(v => typeof v === "number" && Number.isFinite(v) && v >= min, `a number of at least ${min}`);
const port = check(v => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535, "a port number");
const matching = (pattern: RegExp, expected: string) => check(v => typeof v === "string" && pattern.test(v), expected);
const oneOf = (...allowed: string[]) => check(v => typeof v === "string" && allowed.includes(v), `one of ${allowed.join(", ")}`);
const url = check(v => typeof v === "string" && /^https?:\/\//.test(v) && URL.canParse(v), "an http(s) URL");
const anything: Check = () => undefined;
const orNull =
  (inner: Check): Check =>
  (value, path, problems) => {
    if (value !== null) inner(value, path, problems);
  };
const listOf =
  (inner: Check): Check =>
  (value, path, problems) => {
    if (!Array.isArray(value)) problems.push(`${path}: expected a list, got ${show(value)}`);
    else
      value.forEach((item, index) => {
        inner(item, `${path}[${index}]`, problems);
      });
  };
const pair =
  (inner: Check): Check =>
  (value, path, problems) => {
    if (!Array.isArray(value) || value.length !== 2) problems.push(`${path}: expected a pair [a, b], got ${show(value)}`);
    else
      value.forEach((item, index) => {
        inner(item, `${path}[${index}]`, problems);
      });
  };
const shape =
  (required: Record<string, Check>, optional: Record<string, Check> = {}, others?: Check): Check =>
  (value, path, problems) => {
    if (!isRecord(value)) {
      problems.push(`${path}: expected a section with keys, got ${show(value)}`);
      return;
    }
    const at = (key: string) => (path ? `${path}.${key}` : key);
    for (const [key, inner] of Object.entries(required)) inner(value[key], at(key), problems);
    for (const [key, inner] of Object.entries(optional)) if (value[key] !== undefined) inner(value[key], at(key), problems);
    for (const key of Object.keys(value)) {
      if (key in required || key in optional) continue;
      if (others) others(value[key], at(key), problems);
      else problems.push(`${at(key)}: not a setting this app knows (known: ${[...Object.keys(required), ...Object.keys(optional)].join(", ")})`);
    }
  };

const model = orNull(text);

const CONFIG = shape(
  {
    port,
    approval: oneOf("auto", "gated"),
    targets: shape({ holdBack: bool }, { describe: orNull(words) }),
    models: shape(
      { triage: model, discover: model, locate: model, screen: model, prep: model, fill: model, track: model, recheck: model },
      { import: model, interview: model },
    ),
    schedule: shape({ scanMinutes: amount(), discoverMinutes: amount(), trackMinutes: amount() }),
    concurrency: shape({ prep: count() }, { fill: count(1) }),
    limits: shape({ prepPerDay: count(), applyPerDay: count() }, { locatePerDay: count(), applySpreadHours: amount() }),
    fillPauseSeconds: pair(amount()),
    resume: shape({ dir: text, main: text, pdfName: text }),
    chrome: shape({ cdpPort: port, proxyPort: port, display: matching(/^:\d+$/, 'an X display such as ":99"'), window: pair(count(1)), vncPort: count() }),
  },
  {
    publicUrl: orNull(url),
    quietDays: count(1),
    vncUrl: orNull(url),
    mailbox: orNull(matching(/^\S+@\S+$/, "an email address")),
    autoApply: shape({}, { minScore: amount(), allowConcerns: bool, perDay: count(), perEmployer: count() }),
    questionDigest: shape({}, { enabled: bool, time: matching(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm in 24-hour local time"), timeZone: text }),
    feeds: shape({}, {}, shape({ minutes: amount() }, {}, anything)),
    boards: shape(
      { location: text, distance: amount(), queries: listOf(text) },
      { initialHours: amount(), linkedin: shape({ minutes: amount(), pages: count(1) }), indeed: shape({ minutes: amount() }) },
    ),
    retention: shape({}, { chatterDays: amount() }),
  },
);

export function configProblems(raw: unknown): string[] {
  const problems: string[] = [];
  CONFIG(raw, "", problems);
  if (!isRecord(raw)) return problems.map(problem => `config.yml${problem}`);
  if (isRecord(raw)) {
    const pause = raw["fillPauseSeconds"];
    if (Array.isArray(pause) && typeof pause[0] === "number" && typeof pause[1] === "number" && pause[0] > pause[1])
      problems.push(`fillPauseSeconds: the shortest pause (${pause[0]}) is longer than the longest (${pause[1]})`);
    const digest = raw["questionDigest"];
    if (isRecord(digest) && typeof digest["timeZone"] === "string" && digest["timeZone"].trim()) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: digest["timeZone"] });
      } catch {
        problems.push(`questionDigest.timeZone: not an IANA time zone: ${JSON.stringify(digest["timeZone"])}`);
      }
    }
  }
  return problems;
}
