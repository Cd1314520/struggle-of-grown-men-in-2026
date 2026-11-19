import type { ComponentType } from "react";
import type { Page } from "../lib/router";
import { ActivityPage } from "./activity";
import { ApplicationsPage } from "./applications";
import { ArchivePage } from "./archive";
import { JobPage } from "./job";
import { OutreachPage } from "./outreach";
import { OverviewPage } from "./overview";
import { PipelinePage } from "./pipeline";
import { ProfilePage } from "./profile";
import { QuestionsPage } from "./questions";
import { ReferralsPage } from "./referrals";
import { ResumePage } from "./resume";
import { ReviewPage } from "./review";
import { SettingsPage } from "./settings";
import { SetupPage } from "./setup";

export const PAGE_COMPONENTS: Record<Page, ComponentType> = {
  overview: OverviewPage,
  review: ReviewPage,
  questions: QuestionsPage,
  pipeline: PipelinePage,
  applications: ApplicationsPage,
  referrals: ReferralsPage,
  outreach: OutreachPage,
  archive: ArchivePage,
  activity: ActivityPage,
  resume: ResumePage,
  profile: ProfilePage,
  setup: SetupPage,
  settings: SettingsPage,
  job: JobPage,
};
