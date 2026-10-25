import type { ComponentType } from "react";
import type { Page } from "../lib/router";
import { ActivityPage } from "./activity";
import { ApplicationsPage } from "./applications";
import { ArchivePage } from "./archive";
import { JobPage } from "./job";
import { OverviewPage } from "./overview";
import { PipelinePage } from "./pipeline";
import { ProfilePage } from "./profile";
import { QuestionsPage } from "./questions";
import { ReviewPage } from "./review";
import { SettingsPage } from "./settings";

export const PAGE_COMPONENTS: Record<Page, ComponentType> = {
  overview: OverviewPage,
  review: ReviewPage,
  questions: QuestionsPage,
  pipeline: PipelinePage,
  applications: ApplicationsPage,
  archive: ArchivePage,
  activity: ActivityPage,
  profile: ProfilePage,
  settings: SettingsPage,
  job: JobPage,
};
