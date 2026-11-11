import type { PinType } from "../shared/pins";

export const pinIcons = {
  app: "Globe",
  review: "GitPullRequest",
  docs: "BookOpen",
  example: "Code",
  artifact: "FileText",
  link: "Link",
} satisfies Record<PinType, string>;
