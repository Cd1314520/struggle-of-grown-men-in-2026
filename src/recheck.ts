import { createHash } from "node:crypto";
import { config, readProfile } from "./config";
import { kvGet, kvSet, logEvent } from "./db";
import { errorMessage } from "./errors";
import { due } from "./limits";
import { arg, S, schema, type RunWorker } from "./worker";
import { answerGate, listQuestionGroups, type QuestionGroup } from "./questions";
import { stockResumeSource } from "./resume";
import { lowStakesRule, readPrompt, render, termsRule, workDir } from "./worker-tools";

const BATCH = 25;
const SETTLE_MINUTES = 5;
const RETRY_MINUTES = 60;
const CONSIDERED = "recheck.considered";

const fingerprint = () =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.targets.holdBack,
        readProfile("personal.yml"),
        readProfile("answers.md"),
        stockResumeSource(),
        readProfile("resume-notes.md"),
        readPrompt("recheck"),
        readPrompt("low-stakes"),
        readPrompt("terms"),
      ]),
    )
    .digest("hex");

function unconsideredQuestions(): boolean {
  const since = kvGet(CONSIDERED) ?? "";
  const settled = new Date(Date.now() - SETTLE_MINUTES * 60_000).toISOString();
  return listQuestionGroups().some(g => g.kind === "question" && g.jobs.some(j => j.askedAt > since && j.askedAt <= settled));
}

export function recheckDue(): boolean {
  const current = fingerprint();
  const changed = kvGet("recheck.done") !== current;
  if (changed && kvGet("recheck.seen") !== current) {
    kvSet("recheck.seen", current);
    kvSet("recheck.seenAt", new Date().toISOString());
    return false;
  }
  if (!(changed ? due("recheck.seenAt", SETTLE_MINUTES) : unconsideredQuestions())) return false;
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

export function answerProblem(options: readonly string[], answer: string): string | null {
  if (!answer.trim()) return "the answer is blank";
  if (!options.length || options.includes(answer) || answer.split("; ").every(part => options.includes(part))) return null;
  return `"${answer}" is not one of the options; give one verbatim`;
}

async function recheckBatch(run: RunWorker, groups: readonly QuestionGroup[]) {
  let answered = 0;
  let finished = false as boolean;
  const answeredGroups = new Set<QuestionGroup>();
  const leftGroups = new Set<QuestionGroup>();
  const { done } = run({
    name: "recheck",
    builtins: [],
    model: config.models.recheck,
    cwd: workDir(),
    maxTime: "20m",
    prompt: render("recheck", {
      personal: readProfile("personal.yml"),
      answers: readProfile("answers.md"),
      resume: stockResumeSource(),
      resumeNotes: readProfile("resume-notes.md"),
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
          basis: S.str("The answer-bank entry, candidate detail or resume line it comes from, or 'low-stakes'"),
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
            try {
              resumed += answerGate(job.gateId, answer, "application").jobIds.length;
              logEvent("recheck", `Answered from the profile: ${JSON.stringify(group.text)} → ${JSON.stringify(answer)} (${basis})`, job.id, "recheck");
            } catch (err) {
              logEvent("recheck", `Not answered: ${errorMessage(err)}`, job.id, "recheck");
            }
          }
          answeredGroups.add(group);
          if (!resumed) return "Already answered; nothing to do.";
          answered++;
          return "Answered; the application resumes.";
        },
      },
      leave_question: {
        description:
          "Leave one listed question for the candidate, saying why the candidate details, answer bank and resume do not settle it. Call it once for every question you do not answer.",
        parameters: schema({
          number: S.int("Question number from the list"),
          reason: S.str("Specifically why it is left: the fact, choice or agreement it needs that nothing above provides"),
        }),
        handler: args => {
          const group = groups[arg.int(args, "number") - 1];
          if (!group) return "ERROR: no question with that number.";
          const reason = arg.str(args, "reason").trim();
          if (!reason) return "ERROR: give the reason this question is left.";
          if (answeredGroups.has(group)) return "Already answered; nothing to leave.";
          if (leftGroups.has(group)) return "Already left.";
          for (const job of group.jobs) logEvent("recheck", `Left for you: ${JSON.stringify(group.text)} — ${reason}`, job.id, "recheck");
          leftGroups.add(group);
          return "Left for the candidate.";
        },
      },
      recheck_done: {
        description: "Finish once every question has been answered or left.",
        parameters: schema({ summary: S.str("One line: what was answered and what was left for the candidate") }),
        handler: args => {
          const missing = groups.flatMap((g, i) => (answeredGroups.has(g) || leftGroups.has(g) ? [] : [i + 1]));
          if (missing.length) {
            const many = missing.length > 1;
            return `ERROR: question${many ? "s" : ""} ${missing.join(", ")} ${many ? "are" : "is"} neither answered nor left. Call answer_question or leave_question for ${many ? "each" : "it"}, then call recheck_done again.`;
          }
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
  const startedAt = new Date().toISOString();
  const everything = kvGet("recheck.done") !== target;
  const since = kvGet(CONSIDERED) ?? "";
  kvSet("recheck.tried", target);
  kvSet("recheck.triedAt", startedAt);
  const groups = listQuestionGroups().filter(g => g.kind === "question" && (everything || g.jobs.some(j => j.askedAt > since)));
  let answered = 0,
    complete = true;
  for (let i = 0; i < groups.length; i += BATCH) {
    const result = await recheckBatch(run, groups.slice(i, i + BATCH));
    answered += result.answered;
    complete &&= result.finished;
  }
  if (complete) {
    kvSet("recheck.done", target);
    kvSet(CONSIDERED, startedAt);
    kvSet("recheck.tried", "");
  }
  if (groups.length)
    logEvent(
      "system",
      `Recheck: answered ${answered} of ${groups.length} open questions from the profile${complete ? "" : "; a batch did not finish, so they are checked again within the hour"}`,
    );
}
