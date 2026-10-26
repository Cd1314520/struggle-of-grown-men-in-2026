# Task: build the candidate's stock resume from their files

The candidate uploaded files so this pipeline can build the resume every job application is tailored from. Your working directory holds:

- `sources/`: what they uploaded. {{files}}
- `resume.typ`: the layout template. Never edit it, or any other `.typ` file except `{{main}}`.
- `main.example.typ`: an example content file showing how the template is used. Read it first.
- `{{main}}`: {{draft}}
- `resume-notes.md`: the candidate's resume notes, the bank of extra material tailoring may draw on.

PDF and Word files have an extracted text copy next to them (`<name>.txt`); read that first and the original only when the text copy is missing or garbled. For any other format, read the file, or convert it with `bash` (`pdftotext`, `unzip -p`). Images can be read directly.

## Step 1: write `{{main}}`

The resume content, in the shape of `main.example.typ`: `#import "resume.typ": *`, the contact details as `#let` lines, `#show: resume.with(...)`, then `==` sections built from the template's functions (`work`, `edu`, `project`, `certificates`, `extracurriculars`, `dates-helper`). Keep the example's layout settings unless the candidate asks otherwise.

- Everything comes from the sources: names, titles, dates, numbers and tools exactly as they are given there. Do not invent, round up or fill gaps. A contact detail the sources do not give is left out of `resume.with`.
- Where sources disagree, prefer the most recent one, and say so in `warnings`.
- Bullets follow the example: a short bold label, then one line or two on what was done and what came of it.
- Most relevant and recent material first. One US-letter page unless the sources hold clearly more than a page of strong material from several years of experience; never more than two pages.
- What does not fit the page is not lost: it goes into the notes in step 2.

## Step 2: update `resume-notes.md`

Write the whole file back. Keep everything already in it, and keep its structure. Add what the sources hold that the page does not: further bullets for each job, other projects, skills and tools, certifications, numbers. Under "Alternative bullets by role", one heading per job, then one entry per piece of work: what it is good evidence for (`Use for: ...`), the confirmed facts as a list, and one or two ready bullets in the resume's style. Only facts from the sources. Leave the file as it is if the sources hold nothing beyond the page.

## Step 3: compile

Run `typst compile {{main}} {{pdfName}}` and fix every error. Check the page count with `pdfinfo {{pdfName}}`.

## Step 4: report

Call `finish_import` with:

- `summary`: two or three short sentences the candidate reads: what the resume now holds, and what went into the notes.
- `warnings`: up to four short lines, each something the candidate should check before using it: a date or title you were unsure of, a contact detail missing from the sources, material left out and why. Empty string if none.

If the host replies with an ERROR, fix what it names and call `finish_import` again.
{{note}}{{feedback}}
