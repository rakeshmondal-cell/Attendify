/**
 * TEMPORARY DUMMY PROJECT DATA — DELETE AFTER FINAL DEVELOPMENT
 * -------------------------------------------------------------
 * Used only when ATTENDIFY_DUMMY_PM=true so the Android Work tab and
 * local Project Control page have sample allocations/tasks to demo.
 *
 * Remove this file and all call sites once real Project Control data
 * is wired for production.
 */

import type { PmProjectSummary, PmTaskSummary } from "./pmClient.js";

export function dummyPmEnabled(): boolean {
  const raw = (process.env.ATTENDIFY_DUMMY_PM ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function dummyPmWebUrl(): string | null {
  const url = (process.env.ATTENDIFY_DUMMY_PM_WEB_URL ?? "").trim();
  return url || null;
}

/** Sample project + tasks shown in Attendify Work tab while dummy mode is on. */
export function buildDummyWorkload(workDate: string): {
  progressUpdatedToday: boolean;
  openTaskCount: number;
  projects: PmProjectSummary[];
  tasks: PmTaskSummary[];
  message: string;
} {
  const projects: PmProjectSummary[] = [
    {
      name: "[DUMMY] Attendify Demo Project",
      taskCount: 3,
      openTaskCount: 2,
    },
    {
      name: "[DUMMY] Internal QA Sandbox",
      taskCount: 2,
      openTaskCount: 1,
    },
  ];

  const tasks: PmTaskSummary[] = [
    {
      id: "dummy-task-1",
      title: "Review attendance check-in flow",
      status: "In progress",
      projectName: "[DUMMY] Attendify Demo Project",
      dueDate: workDate,
    },
    {
      id: "dummy-task-2",
      title: "Update Project Control progress for today",
      status: "Open",
      projectName: "[DUMMY] Attendify Demo Project",
      dueDate: workDate,
    },
    {
      id: "dummy-task-3",
      title: "Confirm manager daily report rows",
      status: "Done",
      projectName: "[DUMMY] Attendify Demo Project",
      dueDate: workDate,
    },
    {
      id: "dummy-task-4",
      title: "Smoke-test Work tab refresh",
      status: "Open",
      projectName: "[DUMMY] Internal QA Sandbox",
      dueDate: workDate,
    },
    {
      id: "dummy-task-5",
      title: "Archive this dummy project after go-live",
      status: "Open",
      projectName: "[DUMMY] Internal QA Sandbox",
      dueDate: null,
    },
  ];

  return {
    progressUpdatedToday: false,
    openTaskCount: tasks.filter((t) => t.status && !/done|closed|complete/i.test(t.status)).length,
    projects,
    tasks,
    message:
      "TEMPORARY dummy project data (ATTENDIFY_DUMMY_PM). Delete after final development.",
  };
}
