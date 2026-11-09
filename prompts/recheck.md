# Recheck parked questions

Each application below is parked on one question: the agent filling its form asked the candidate, who has not answered yet. The candidate details, answer bank and resume may say more than they did when it asked. Answer every question they now settle and leave the rest for the candidate.

## Candidate details

{{personal}}

## Answer bank

{{answers}}

## Resume

This is the candidate's stock resume (Typst source); what it shows is what the candidate has done.

{{resume}}

## Resume notes

The candidate's notes for tailoring the resume. Their facts count as what the candidate has done, though not every one is on the resume (Agile sprints, Jira, extra projects).

{{resumeNotes}}

## When to answer

- Answer when the candidate details or the answer bank settle the question, in meaning however the employer words it, for its context and employer: an entry covers it, or the answer follows directly from what they state. Keep to each entry's own limits: an entry that says to ask, or that excludes some employers, does not answer those cases.
- **Skills and experience:** a yes/no or rating question about a skill, language, tool or kind of experience is answered from the resume and the resume notes, not left: yes when either shows it, no when neither does, and a rating that matches what they show.
- **Free text:** for a free-text question ("why this company…", "describe your experience with…"), write a concise, specific, honest answer grounded in the resume and the question's context. Do not invent facts, employers, numbers or enthusiasm the resume and context do not support.
- **Low-stakes questions:** {{lowStakes}}
- **Terms and agreements:** {{terms}} The page cannot be opened from here: judge the agreement by the text quoted with the question.
- Leave a question that needs an unknown fact or decision (a salary figure, a date, a referral name, an ID or number), a legal attestation beyond the ordinary terms above, or anything where a wrong answer would misstate the candidate. A wrong answer goes onto a real application; an unanswered question only waits for the candidate.

## How to answer

Call `answer_question` with the question's number and exactly what to enter. Where the question lists options, give one of them verbatim, or several separated by "; " only where the question lets you pick more than one. For free text, give the text to type, edited as "Editing a free-text answer" below says. In `basis`, name the answer-bank entry, candidate detail or resume line the answer comes from, or say "low-stakes". Each answer resumes that application.

## How to leave

Call `leave_question` with the question's number and a `reason` for every question you do not answer. The reason says specifically what is missing or why it needs the candidate ("asks for a salary figure; none in the details", "attests to a clearance the resume does not mention"), never just "unclear". The candidate reads it next to the question.

When every question has been either answered or left, call `recheck_done`. It refuses to finish while a question has neither.

## Editing a free-text answer before you type it

Every free-text answer you write yourself (a "why this company", a short essay, an "anything else"), as opposed to one copied unchanged from the answer bank or the candidate details, goes through the rules below before it is typed. Use them in embedded mode: draft the answer, check it against the patterns, and type only the final version, never the draft or a list of patterns. There is no one to ask: where a sentence needs a detail you do not have, write a simpler sentence. The candidate's own answers in the answer bank are the writing sample to match. These rules add to the writing rules in your system prompt; where the two differ, the stricter one holds.

{{humanizer}}

## Questions

{{questions}}
