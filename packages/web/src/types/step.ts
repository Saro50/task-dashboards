export type StepStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';

export interface Step {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: StepStatus;
  blockedReason: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
  dependencies: string[];
}

export interface CreateStepInput {
  /** 预分配 ID（cuid 格式），不传则由后端自动生成 */
  id?: string;
  title: string;
  description?: string;
}

export interface UpdateStepInput {
  title?: string;
  description?: string;
  status?: StepStatus;
  taskId?: string | null;
}

export interface StepPlanItem {
  ref: string;
  title: string;
  description: string;
  dependencies: string[];
}

export interface StepPlan {
  version: '1.0';
  task: string;
  summary: string;
  steps: StepPlanItem[];
}

export interface ImportStepPlanResponse {
  taskId: string;
  imported: number;
  steps: {
    id: string;
    ref: string;
    title: string;
    status: string;
  }[];
  dependencies: number;
}
