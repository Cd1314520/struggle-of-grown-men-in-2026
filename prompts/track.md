# Task: update application statuses from the mailbox

The mailbox `{{mailbox}}` is dedicated to this job search. Find mail that arrived since {{since}} and work out what it means for the open applications listed below.

- Use `gmail_search` (Gmail query syntax, e.g. `after:{{sinceDate}}`) and `gmail_read`.
- For each message about an application, call `update_application` with the job id, the new status and a one-line note quoting the key fact (interview request with proposed times, rejection, assessment link and deadline, request for more information).
  - `submitted`: only a receipt/confirmation; nothing new.
  - `interview`: any request to schedule a call, interview or assessment.
  - `offer`, `rejected_by_company`: as they say.
- Mail that needs the candidate's attention but matches no listed application: call `note` with a one-line summary.
- Do not reply to anything and do not click links in mail.
- Call `gmail_mark_read` on messages you have fully processed.

Finish by calling `track_done` with a one-line summary.

## Open applications (id | company | title | submitted)

{{applications}}
