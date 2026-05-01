// Types for the work module.

export interface WorkStatus {
  active: boolean;
  secondsLeft: number | null;
  jobName: string | null;
}
