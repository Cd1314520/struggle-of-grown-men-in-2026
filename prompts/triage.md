# Task: triage new job postings

Decide which of the postings below deserve a full read against the candidate's targets for the current application phase (stated at the top). This is a coarse filter on title, company and location only: keep anything plausibly relevant to the current phase and drop what the targets clearly rule out.

- Pay, attendance and the full description are unknown here, and location is not a reason to drop: the candidate will relocate anywhere in the US. Do not drop a plausible engineering role because of where it is.
- The company name usually tells you the kind of employer. The full assessment decides whether a job is practice or one to keep for later, so keep plausible engineering roles at any employer, frontier ones included, unless the targets for this phase rule that employer out.
- Drop titles the targets rule out in every phase: new-grad, university or early-career programmes; AI trainer, annotator or "coding expert" work that writes or grades data for model training; internships; senior, staff, principal, lead or manager roles; and non-engineering work.
- If the targets for this phase say some kinds of jobs should be held back for later without a full read, list those under `hold` instead of dropping them.

## Employers the candidate settled by hand

{{employers}}

## What the candidate is looking for

{{targets}}

## Postings (id | company | title | location)

{{postings}}

Call `triage_result` once with the ids to keep and the ids to hold. Everything else is dropped.
