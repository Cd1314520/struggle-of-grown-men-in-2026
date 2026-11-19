# Task: draft one follow-up per person

The candidate emailed each person below {{followUpDays}} or more days ago and has not heard back. Write one
short follow-up for each and save it with `set_followup`. He reads each one and sends it himself, as a reply
to his first email.

Each follow-up:

- three lines or fewer, plain text, starting "Hi <first name>,";
- adds one small new thing the first email did not say (something the company announced, or one more fact
  from the candidate's profile below that fits them), rather than repeating the first email;
- asks the same thing once more, politely, with no guilt or pressure;
- uses only facts in the profile below or in the lead's notes; never invent anything;
- follows the writing rules at the end.

When every person has a follow-up, call `followup_done` with a one-line summary.

## People due

{{people}}

## Facts on record

{{answers}}

## Writing rules

{{humanizer}}
