// Interview prep, once the employer has moved an application on: a prep note an agent writes on request,
// and the candidate's story bank (profile/story-bank.md) to pick stories from (src/interview.ts).
import { NotebookPen } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Button, Disclosure, Markdown, Section, Time } from "../../components/ui";
import { api, queryClient } from "../../lib/api";

export function InterviewPrep({ job }: { job: JobDetail }) {
  const prep = job.interviewPrep;
  const [asked, setAsked] = useState(false);
  if (!prep) return null;
  const writing = prep.writing || asked;
  const write = () => {
    setAsked(true);
    void api
      .prepNote(job.id)
      .catch(() => undefined)
      .finally(() => {
        setAsked(false);
        void queryClient.invalidateQueries({ queryKey: ["job", job.id] });
      });
  };
  return (
    <Section
      title="Interview prep"
      description={
        prep.noteAt ? (
          <Time at={prep.noteAt} prefix="Note written " />
        ) : (
          "An agent reads the posting, your resume, your answers and your stories, and writes a short note for the next round."
        )
      }
      actions={
        <Button variant="secondary" size="sm" onClick={write} disabled={writing}>
          <NotebookPen />
          {writing ? "Writing the note…" : prep.note ? "Write it again" : "Write a prep note"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {prep.note && <Markdown text={prep.note} className="text-base text-fg" />}
        <Disclosure id={`stories:${job.id}`} summary="Your story bank">
          <Markdown text={prep.stories} />
        </Disclosure>
      </div>
    </Section>
  );
}
