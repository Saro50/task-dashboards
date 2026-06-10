export interface ImportStepPlanRequest {
  task: string;
  summary: string;
  steps: {
    ref: string;
    title: string;
    description: string;
    dependencies: string[];
  }[];
  chatSessionId?: string;
  taskId?: string;
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
  planHash?: string;
}

export interface ImportedPlanItem {
  planHash: string;
  taskName: string;
  projectId: string;
  taskId: string | null;
}
