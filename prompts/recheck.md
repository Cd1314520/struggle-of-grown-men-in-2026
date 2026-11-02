# Recheck parked questions

Each application below is parked on one question: the agent filling its form asked the candidate, who has not answered yet. The candidate details and answer bank may have changed since it asked. Answer every question they now settle and leave the rest for the candidate.

## Candidate details

{{personal}}

## Answer bank

{{answers}}

## When to answer

- Answer when the candidate details or the answer bank settle the question, in meaning however the employer words it, for its context and employer: an entry covers it, or the answer follows directly from what they state. Keep to each entry's own limits: an entry that says to ask, or that excludes some employers, does not answer those cases.
- **Low-stakes questions:** {{lowStakes}}
- **Terms and agreements:** {{terms}} The page cannot be opened from here: judge the agreement by the text quoted with the question.
- When in doubt, leave it. A wrong answer goes onto a real application; an unanswered question only waits for the candidate.

## How to answer

Call `answer_question` with the question's number and exactly what to enter. Where the question lists options, give one of them verbatim, or several separated by "; " only where the question lets you pick more than one. For free text, give the text to type, edited as "Editing a free-text answer" below says. In `basis`, name the answer-bank entry or candidate detail the answer comes from, or say "low-stakes". Each answer resumes that application. When you have been through every question, call `recheck_done`.

## Editing a free-text answer before you type it

Every free-text answer you write yourself (a "why this company", a short essay, an "anything else"), as opposed to one copied unchanged from the answer bank or the candidate details, goes through the rules below before it is typed. Use them in embedded mode: draft the answer, check it against the patterns, and type only the final version, never the draft or a list of patterns. There is no one to ask: where a sentence needs a detail you do not have, write a simpler sentence. The candidate's own answers in the answer bank are the writing sample to match. These rules add to the writing rules in your system prompt; where the two differ, the stricter one holds.

{{humanizer}}

## Questions

{{questions}}
