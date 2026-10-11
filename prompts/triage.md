# Task: triage new job postings

Decide which of the postings below deserve a full read against the candidate's targets for the current application phase (stated at the top). This is a coarse filter on title, company and location only: keep anything plausibly relevant to the current phase and drop what the targets clearly rule out.

**Important for triage vs. final assessment:**
At coarse triage, salary, workplace attendance policies, and full job descriptions are UNKNOWN. When salary or mandatory attendance is unknown, KEEP plausible engineering roles so they receive a full assessment; do NOT hold or drop them at triage merely because positive practice proof is not yet visible. A hold for lack of positive practice proof occurs only at final assessment after reading the full posting. At triage, only hold roles if they are definitely known high-priority Real matches that must be preserved. If the targets for this phase say some kinds of jobs should be held back for later, list those under `hold` instead of dropping them.

## What the candidate is looking for

{{targets}}

## Postings (id | company | title | location)

{{postings}}

Call `triage_result` once with the ids to keep and the ids to hold. Everything else is dropped.
