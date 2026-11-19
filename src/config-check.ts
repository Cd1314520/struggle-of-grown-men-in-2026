// What config.yml must look like. `configProblems` reads the parsed file and says everything that is
// wrong with it at once, by path, so a mistyped key or a number written as text stops the app at
// start instead of surfacing later as a schedule that never fires or a cap that never binds.
//
// This module must not import anything that reads configuration.

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
const regex = check(v => {
  if (typeof v !== "string" || !v.trim()) return false;
  try {
    new RegExp(v, "i");
    return true;
  } catch {
    return false;
  }
}, "a regular expression");
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
// An object with exactly these keys. A key not listed is a mistake unless `others` says what any
// further key may hold.
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
// One fallback model, or several to try in order.
const fallbacks: Check = (value, path, problems) => {
  if (Array.isArray(value)) listOf(text)(value, path, problems);
  else check(v => typeof v === "string" && !!v.trim(), "a model or a list of models")(value, path, problems);
};
const STAGES = ["triage", "discover", "locate", "screen", "prep", "fill", "track", "recheck", "import"];

const CONFIG = shape(
  {
    port,
    approval: oneOf("auto", "gated"),
    targets: shape({ holdBack: bool }, { describe: orNull(words) }),
    // import was added later: a config.yml from before it still loads, and the resume import uses omp's default.
    models: shape(
      { triage: model, discover: model, locate: model, screen: model, prep: model, fill: model, track: model, recheck: model },
      { import: model, interview: model, outreach: model, fallback: shape({}, Object.fromEntries(STAGES.map(stage => [stage, fallbacks]))) },
    ),
    schedule: shape({ scanMinutes: amount(), discoverMinutes: amount(), trackMinutes: amount() }),
    concurrency: shape({ prep: count() }, { fill: count(1) }),
    limits: shape(
      { prepPerDay: count(), applyPerDay: count() },
      { locatePerDay: count(), applySpreadHours: amount(), fillSteps: count(), locateSteps: count() },
    ),
    fillPauseSeconds: pair(amount()),
    resume: shape({ dir: text, main: text, pdfName: text }),
    chrome: shape(
      { cdpPort: port, proxyPort: port, display: matching(/^:\d+$/, 'an X display such as ":99"'), window: pair(count(1)), vncPort: count() },
      { offscreen: bool },
    ),
  },
  {
    publicUrl: orNull(url),
    quietDays: count(1),
    outreach: shape(
      {},
      {
        minutes: amount(),
        perDay: count(1),
        leadsPerRun: count(1),
        minScore: amount(),
        followUpDays: count(1),
        resuggestDays: count(),
        hunterPerDay: count(),
        sendFrom: orNull(matching(/^\S+@\S+$/, "an email address")),
        hunterKey: orNull(text),
      },
    ),
    vncUrl: orNull(url),
    mailbox: orNull(matching(/^\S+@\S+$/, "an email address")),
    coverLetters: oneOf("skip", "draft"),
    ownWritingAbove: amount(),
    autoApply: shape(
      {},
      {
        minScore: amount(),
        allowConcerns: bool,
        perDay: count(),
        perEmployer: count(),
        cooldownDays: count(),
        lowerBar: shape({ minScore: amount(), anyOf: listOf(text) }),
      },
    ),
    questionDigest: shape({}, { enabled: bool, time: matching(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm in 24-hour local time"), timeZone: text }),
    screen: shape(
      {},
      {
        titles: orNull(regex),
        readPostings: bool,
        terms: orNull(listOf(matching(/^(spring|summer|fall|autumn|winter)\s*(20)?\d{2}$/i, "a term such as Summer 2027"))),
      },
    ),
    triage: shape({}, { batch: count(1), waitHours: amount() }),
    // Each feed and board takes its own extra parameters.
    feeds: shape({}, {}, shape({ minutes: amount() }, {}, anything)),
    boards: shape(
      { location: text, distance: amount(), queries: listOf(text) },
      { initialHours: amount(), linkedin: shape({ minutes: amount(), pages: count(1) }), indeed: shape({ minutes: amount() }) },
    ),
    retention: shape({}, { chatterDays: amount() }),
    fallback: listOf(text),
    claudeAccounts: listOf(text),
  },
);

// Everything wrong with a parsed config.yml; empty when it can be used.
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
        // Intl knows the IANA zones; a digest must never be scheduled in the host's zone by accident.
        new Intl.DateTimeFormat("en-US", { timeZone: digest["timeZone"] });
      } catch {
        problems.push(`questionDigest.timeZone: not an IANA time zone: ${JSON.stringify(digest["timeZone"])}`);
      }
    }
  }
  return problems;
}
