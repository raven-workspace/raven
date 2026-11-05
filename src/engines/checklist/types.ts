import type { EngagementKind } from '../../types/engagement';

export type { EngagementKind };

export type PlaybookId = 'nocreds' | 'user' | 'da';

/**
 * Every criterion present must hold. `ports` and `services` are alternatives to each other
 * (any open port or any scanned service matches). `ports: []` with no `services` means
 * "any known open port", i.e. the host has been scanned.
 */
export interface GoalApplies {
  os?: ('linux' | 'windows')[];
  ports?: number[];
  services?: string[];
  dualHomed?: true;
  domainJoined?: true;
  kinds?: EngagementKind[];
}

export interface ChecklistGoal {
  id: string;
  stage: string;
  title: string;
  why?: string;
  /** Sub-heading inside its stage; every goal of a stage that uses groups carries one. */
  group?: string;
  applies?: GoalApplies;
}

export interface ChecklistStage {
  id: string;
  title: string;
  goals: ChecklistGoal[];
  emptyHint?: string;
  /** `engagement`: shown on the engagement view, never on a host's own checklist. */
  placement?: 'engagement';
}
