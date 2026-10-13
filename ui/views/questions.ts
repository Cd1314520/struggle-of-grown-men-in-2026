// The Questions inbox: open gates grouped by what is being asked.
import { state } from "../store";
import { esc, plural } from "../util";
import { title } from "./common";

// The exact context and options a question was asked with.
export function questionDetailsHtml(p: { context: string; options: string[] }) {
  return `${p.context ? `<div class="section"><div class="label">Exact context</div><p class="said">${esc(p.context)}</p></div>` : ""}
    ${p.options.length ? `<div class="section"><div class="label">Exact options</div><ul>${p.options.map(o => `<li class="said">${esc(o)}</li>`).join("")}</ul></div>` : ""}`;
}

export function questionsHtml() {
  const groups = state().questionGroups;
  return `<div class="doc page" id="questions-inbox">${title(`Questions · ${plural(groups.length, "group")}`)}
    <p class="hint">Application-only answers requeue the selected application. Standing answers require explicit approval and match only the same employer, exact prompt, context and options. Cover letters, final approvals and browser handoffs remain per application.</p>
    ${
      groups.length
        ? groups
            .map(
              (g, i) => `<section class="question-group" data-question-group="${esc(g.key)}" aria-labelledby="question-${i}">
      <div class="label">${esc(g.kind.replace(/_/g, " "))} · ${plural(g.jobs.length, "application")}</div>
      <h2 id="question-${i}">${esc(g.text)}</h2>${questionDetailsHtml(g)}
      <div class="section"><div class="label">Affected applications</div><ul>${g.jobs.map(j => `<li><a href="#progress/${j.id}">${esc(j.company)} · ${esc(j.title)} · #${j.id}</a></li>`).join("")}</ul></div>
      ${
        g.kind === "question"
          ? `<form data-question-form>
        <label for="question-job-${i}">Application to answer<select id="question-job-${i}" name="job">${g.jobs.map(j => `<option value="${esc(j.gateId)}">${esc(j.company)} · ${esc(j.title)} · #${j.id}</option>`).join("")}</select></label>
        <label for="question-answer-${i}">Your answer<textarea id="question-answer-${i}" name="answer" rows="3" required></textarea></label>
        <fieldset aria-describedby="question-scope-${i}"><legend>Answer scope</legend>
          <label><input type="radio" name="scope" value="application" checked> This application only (default)</label>
          ${g.standingAllowed ? `<label><input type="radio" name="scope" value="standing"> Explicitly approve a standing answer</label>` : ""}
        </fieldset>
        <p class="hint" id="question-scope-${i}">${g.standingAllowed ? `${esc(g.scopeLabel)}. Standing approval requeues all ${g.jobs.length} matching open applications listed here and permits future reuse only within this exact scope. It is not a global profile answer.` : `Application-only. ${esc(g.scopeLabel)}. No standing reuse is available for this question.`}</p>
        <div class="actions"><button class="btn primary" type="submit" data-question-answer>Save answer and queue</button></div>
      </form>`
          : `<p class="hint" style="margin-top:14px">Resolve this ${esc(g.kind.replace(/_/g, " "))} in its application. No standing answer is available.</p>`
      }
    </section>`,
            )
            .join("")
        : `<div class="empty">No open questions or decisions.</div>`
    }
  </div>`;
}
