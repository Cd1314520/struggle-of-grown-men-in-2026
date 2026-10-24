# Recheck parked questions

Each application below is parked on one question: the agent filling its form asked the candidate, who has not answered yet. The candidate details and answer bank may have changed since it asked. Answer every question they now settle and leave the rest for the candidate.

## Candidate details

{{personal}}

## Answer bank

{{answers}}

## When to answer

- Answer when the candidate details or the answer bank settle the question for its exact wording, context and employer: an entry covers it, or the answer follows directly from what they state. Keep to each entry's own limits: an entry that says to ask, or that excludes some employers, does not answer those cases.
- **Low-stakes questions:** {{lowStakes}}
- Terms and agreements: accept only what the answer bank says to accept. Arbitration, a waiver of legal rights, or anything else the bank says to ask about stays with the candidate.
- When in doubt, leave it. A wrong answer goes onto a real application; an unanswered question only waits for the candidate.

## How to answer

Call `answer_question` with the question's number and exactly what to enter. Where the question lists options, give one of them verbatim, or several separated by "; " only where the question lets you pick more than one. For free text, give the text to type. In `basis`, name the answer-bank entry or candidate detail the answer comes from, or say "low-stakes". Each answer resumes that application. When you have been through every question, call `recheck_done`.

## Questions

{{questions}}
