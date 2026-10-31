# Task: assess one job and tailor the resume

Job #{{id}}: **{{title}}** at **{{company}}** ({{location}})
{{url}}
{{otherListings}}
## Step 1: answer the checklist and practice facts

You do not score this job. Answer each statement below about the posting with `yes`, `no` or `unclear`, and give the short quote or fact that decides it. Judge each statement on its own, literally as written. Use `unclear` only when the posting really does not say; do not guess, and do not let one answer colour another. If the description below is missing or thin, read the posting at the URL first. For statements about the candidate, use `{{main}}` in your working directory.

{{checklist}}

Judge the employer as well; statements about the employer and the organisation may draw on what is generally known about the company, not only the posting. The candidate settled some employers by hand, and those lists override your own judgment:

{{employers}}

Also send the `practice` object, which says what kind of employer this is:
{{targets}}- `employerEvidence`: one sentence naming what about the company decides what kind of employer it is (its size and stage, its core business). Never empty.
- `agentNative`: whether the engineering organisation visibly builds and ships with AI agents.
  - `"yes"`: concrete signs such as agents used in daily engineering, agentic products, internal agent platforms, or public engineering writing about it.
  - `"no"`: concrete signs it is behind, such as a posting that introduces AI coding tools as new, a legacy stack with no AI work in sight, or a team described as just starting on AI.
  - `"unclear"`: anything else. Do not guess.
- `agentNativeEvidence`: the fact that decides a yes or no; empty only when unclear.

Call `submit_checklist` with an answer for every checklist id and the `practice` object. The orchestrator computes the score from fixed weights and replies either CONTINUE or STOP. On STOP you are finished: do not tailor anything.

## Step 2: tailor the resume

Your working directory holds a copy of the stock resume project. `{{main}}` is the content; any other `.typ` file is the layout template.

- Edit `{{main}}` only. Never change the template files, the contact details, or the layout settings at the top of `{{main}}`.
- Reorder and trim bullets so the most relevant evidence comes first.
- Swap in alternative bullets, projects or skills from the resume notes where they fit this job better. If the notes are empty, work only with what the stock resume says.
- Mirror the job's vocabulary only where it is a true description of what the candidate did.
- Everything on the resume must come from the stock resume or the notes. Do not add or inflate anything.
- Keep the same structure and bullet style, and do not exceed the stock resume's page count. Avoid leaving the page visibly emptier than the stock version.

Then run `typst compile {{main}} {{pdfName}}` and fix any errors. The output must have exactly that filename: no suffixes, versions or company names. If `typst` is not available to you, skip it: `finish_prep` compiles `{{main}}` itself and returns any errors to fix.

## Step 3: report

Call `finish_prep` with:

- `rationale`: at most two short sentences (under 35 words) the candidate reads on a phone: what the role is, then the single strongest reason they fit. No numeric rating, no restating the checklist.
- `concerns`: at most two short lines, each a real gap or risk about this job the candidate should know before applying (a missing required skill, pay, location, seniority). Empty string if none. Do not flag pay or relocation as concerns: the candidate puts experience first and will relocate. Never mention the tooling, compilation, PDF warnings or your own process.
- `resume_changes`: up to five short bullets, each one change and why. Do not report that it compiled or how many pages it is.
{{feedback}}
## Resume notes (bank of alternative content and guidance)

{{notes}}

## Job description

{{description}}
