import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, DATA, PROFILE, readProfile } from "./config";
import { kvSet, logEvent } from "./db";
import { errorMessage } from "./errors";
import { due } from "./limits";
import { markFiled, unfiledAnswers, type BankedAnswer } from "./questions";
import { arg, S, schema, type RunWorker } from "./worker";
import { render, workDir } from "./worker-tools";

const BATCH = 25;
const RETRY_MINUTES = 60;
const HISTORY = join(DATA, "answer-bank");

const waiting = () => unfiledAnswers(BATCH);

export const bankDue = () => unfiledAnswers(1).length > 0 && due("bank.failedAt", RETRY_MINUTES);

const keptList = (kept: readonly BankedAnswer[]) =>
  kept
    .map((k, i) =>
      [
        `${i + 1}. ${k.employer}${k.title ? `, applying for ${k.title}` : ""} (${k.answeredAt.slice(0, 10)})`,
        `Question: ${k.question}`,
        `Context: ${k.context || "(none)"}`,
        `Options: ${k.options.length ? JSON.stringify(k.options) : "free text"}`,
        `Answer: ${k.answer}`,
      ].join("\n"),
    )
    .join("\n\n");

export function editText(text: string, old: string, next: string): string {
  if (!old) return `${text.trimEnd()}\n\n${next.trim()}\n`;
  const at = text.indexOf(old);
  if (at < 0) throw new Error("old_text is not in answers.md");
  if (text.includes(old, at + 1)) throw new Error("old_text appears more than once in answers.md; include more of the text around it");
  return text.slice(0, at) + next + text.slice(at + old.length);
}

async function fileBatch(run: RunWorker, kept: readonly BankedAnswer[], stamp: string) {
  let edits = 0;
  let finished = false as boolean;
  const file = join(PROFILE, "answers.md");
  const { done } = run({
    name: "bank",
    stage: "recheck",
    builtins: [],
    model: config.models.recheck,
    cwd: workDir(),
    maxTime: "20m",
    prompt: render("answer-bank", { personal: readProfile("personal.yml"), answers: readProfile("answers.md"), kept: keptList(kept) }),
    tools: {
      edit_answers: {
        description:
          "Change profile/answers.md: replace old_text, copied exactly from the file and found there once, with new_text. An empty old_text adds new_text at the end of the file.",
        parameters: schema({
          old_text: S.str("Text of the file to replace, exactly as it stands; empty to add at the end"),
          new_text: S.str("What replaces it"),
        }),
        handler: args => {
          const before = readProfile("answers.md");
          let after: string;
          try {
            after = editText(before, arg.str(args, "old_text"), arg.str(args, "new_text"));
          } catch (err) {
            return `ERROR: ${errorMessage(err)}. The file as it now stands:\n\n${before}`;
          }
          const saved = join(HISTORY, `${stamp}-answers.md`);
          if (!existsSync(saved) && existsSync(file)) {
            mkdirSync(HISTORY, { recursive: true });
            copyFileSync(file, saved);
          }
          writeFileSync(file, after);
          edits++;
          return "Saved.";
        },
      },
      answers_filed: {
        description: "Finish once every listed answer is filed or deliberately left out.",
        parameters: schema({ summary: S.str("One line per answer, by number: what changed in answers.md, or why it was left out") }),
        handler: args => {
          finished = true;
          markFiled(kept.map(k => k.id));
          logEvent("system", `Answers: ${arg.str(args, "summary")}`);
          return "Done.";
        },
      },
    },
  });
  await done;
  return { edits, finished };
}

export async function fileKeptAnswers(run: RunWorker): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let edits = 0;
  for (let kept = waiting(); kept.length; kept = waiting()) {
    const result = await fileBatch(run, kept, stamp);
    edits += result.edits;
    if (!result.finished) {
      kvSet("bank.failedAt", new Date().toISOString());
      logEvent("system", `Adding kept answers to answers.md did not finish; ${kept.length} are tried again within the hour`);
      return edits > 0;
    }
  }
  kvSet("bank.failedAt", new Date(0).toISOString());
  return edits > 0;
}
