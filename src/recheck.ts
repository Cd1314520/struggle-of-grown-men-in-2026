// Recheck: questions that parked before the profile could answer them. Nothing else looks at a parked
// question again until the candidate answers it, so when profile/personal.yml, profile/answers.md or the
// rules for answering change, an agent reads every open question against them and answers the ones
// they now settle. Each answer resumes its application as if the candidate had given it.
import { createHash } from "node:crypto";
import { config, readProfile } from "./config";
import { kvGet, kvSet, logEvent } from "./db";
import { errorMessage } from "./errors";
import { due } from "./limits";
import { arg, S, schema, type RunWorker } from "./worker";
import { answerGate, listQuestionGroups, type QuestionGroup } from "./questions";
import { lowStakesRule, readPrompt, render, termsRule, workDir } from "./worker-tools";

// Questions per worker: enough to share one read of the profile, few enough that long legal context still fits.
const BATCH = 25;
// Someone editing answers.md saves it several times; check once it has stopped changing.
const SETTLE_MINUTES = 5;
// A run that did not finish is tried again after this long, not on every tick.
const RETRY_MINUTES = 60;

const fingerprint = () =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.targets.holdBack,
        readProfile("personal.yml"),
        readProfile("answers.md"),
        readPrompt("recheck"),
        readPrompt("low-stakes"),
        readPrompt("terms"),
      ]),
    )
    .digest("hex");

// Whether the profile or the rules have changed since the open questions were last checked against them.
export function recheckDue(): boolean {
  const current = fingerprint();
  if (kvGet("recheck.done") === current) return false;
  if (kvGet("recheck.seen") !== current) {
    kvSet("recheck.seen", current);
    kvSet("recheck.seenAt", new Date().toISOString());
    return false;
  }
  if (!due("recheck.seenAt", SETTLE_MINUTES)) return false;
  return kvGet("recheck.tried") !== current || due("recheck.triedAt", RETRY_MINUTES);
}

export function questionList(groups: readonly QuestionGroup[]) {
  return groups
    .map((g, i) =>
      [
        `${i + 1}. ${g.jobs[0]?.company ?? "?"}, applying for ${g.jobs.map(j => j.title).join("; ")}`,
        `Question: ${g.text}`,
        `Context: ${g.context || "(none)"}`,
        `Options: ${g.options.length ? JSON.stringify(g.options) : "free text"}`,
      ].join("\n"),
    )
    .join("\n\n");
}

// Where a question lists options, an answer is one of them, or several where more than one may be picked.
export function answerProblem(options: readonly string[], answer: string): string | null {
  if (!answer.trim()) return "the answer is blank";
  if (!options.length || options.includes(answer) || answer.split("; ").every(part => options.includes(part))) return null;
  return `"${answer}" is not one of the options; give one verbatim`;
}

async function recheckBatch(run: RunWorker, groups: readonly QuestionGroup[]) {
  let answered = 0;
  let finished = false as boolean; // set from the tool callback
  const { done } = run({
    name: "recheck",
    builtins: [],
    model: config.models.recheck,
    cwd: workDir(),
    maxTime: "20m",
    prompt: render("recheck", {
      personal: readProfile("personal.yml"),
      answers: readProfile("answers.md"),
      lowStakes: lowStakesRule(),
      terms: termsRule(),
      questions: questionList(groups),
    }),
    tools: {
      answer_question: {
        description: "Answer one listed question for the candidate. Its application resumes with this answer.",
        parameters: schema({
          number: S.int("Question number from the list"),
          answer: S.str("Exactly what to enter: an option verbatim, or the text to type"),
          basis: S.str("The answer-bank entry or candidate detail it comes from, or 'low-stakes'"),
        }),
        handler: args => {
          const group = groups[arg.int(args, "number") - 1];
          if (!group) return "ERROR: no question with that number.";
          const answer = arg.str(args, "answer"),
            basis = arg.str(args, "basis");
          const problem = answerProblem(group.options, answer);
          if (problem) return `ERROR: ${problem}.`;
          let resumed = 0;
          for (const job of group.jobs) {
            // The candidate may have answered it meanwhile: that answer stands.
            try {
              resumed += answerGate(job.gateId, answer, "application").jobIds.length;
              logEvent("recheck", `Answered from the profile: ${JSON.stringify(group.text)} → ${JSON.stringify(answer)} (${basis})`, job.id, "recheck");
            } catch (err) {
              logEvent("recheck", `Not answered: ${errorMessage(err)}`, job.id, "recheck");
            }
          }
          if (!resumed) return "Already answered; nothing to do.";
          answered++;
          return "Answered; the application resumes.";
        },
      },
      recheck_done: {
        description: "Finish once every question has been considered.",
        parameters: schema({ summary: S.str("One line: what was answered and what was left for the candidate") }),
        handler: args => {
          finished = true;
          logEvent("system", `Recheck: ${arg.str(args, "summary")}`);
          return "Done.";
        },
      },
    },
  });
  await done;
  return { answered, finished };
}

export async function recheckOpenQuestions(run: RunWorker) {
  const target = fingerprint();
  kvSet("recheck.tried", target);
  kvSet("recheck.triedAt", new Date().toISOString());
  const groups = listQuestionGroups().filter(g => g.kind === "question");
  let answered = 0,
    complete = true;
  for (let i = 0; i < groups.length; i += BATCH) {
    const result = await recheckBatch(run, groups.slice(i, i + BATCH));
    answered += result.answered;
    complete &&= result.finished;
  }
  if (complete) kvSet("recheck.done", target);
  if (groups.length)
    logEvent(
      "system",
      `Recheck: answered ${answered} of ${groups.length} open questions from the profile${complete ? "" : "; a batch did not finish, so they are checked again within the hour"}`,
    );
}
