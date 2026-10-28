# File answers into the answer bank

The candidate answered each question below on an application form and chose to keep the answer for the answer bank: `profile/answers.md`, which the agents filling application forms answer from. File them, so that the next form asking the same thing, however it is worded, is answered without asking the candidate again.

## Candidate details

{{personal}}

## Answer bank

{{answers}}

## How to file an answer

- Work out what the answer tells about the candidate beyond the one form: the fact, preference or decision behind it, and the questions it settles. "Have you worked for Acme before? No" says the candidate has never worked for Acme; "Desired salary? 140000" gives the figure to ask for wherever no entry says otherwise.
- Where an entry already covers the subject, widen or correct it rather than add another: one entry per subject, naming the phrasings it settles. Where a new answer contradicts an entry, the new answer stands: rewrite the entry to say it.
- Otherwise add an entry in the file's own form, a `###` heading that names the question in general terms and then the answer, under the section it belongs to; under "Added from applications" only when no section fits.
- Keep to what the candidate said. Never add a fact, condition or reason they did not give, and never stretch a consent or legal attestation beyond what the answer says. An answer that holds only for that employer or that form (consent to that employer's terms, a referral, why that company) goes in naming the employer, or not at all.
- Leave out an answer that says nothing beyond its form, and one the candidate details or an entry already say.
- Leave alone the entries the new answers do not bear on.

## How to edit

Call `edit_answers` for each change: `old_text` copied exactly from the file as it now stands, enough of it to be found only once, and `new_text` to put in its place. An empty `old_text` adds `new_text` at the end of the file. When every answer below is filed or left out, call `answers_filed` with one line per answer saying what you did.

## Answers to file

{{kept}}
