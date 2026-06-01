export interface ImportTaskPlanRequest {
  topic: string;
  summary: string;
  tasks: {
    ref: string;
    title: string;
    description: string;
    dependencies: string[];
  }[];
  chatSessionId?: string;
  topicId?: string;
}

export interface ImportTaskPlanResponse {
  topicId: string;
  imported: number;
  tasks: {
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
  topicName: string;
  projectId: string;
  topicId: string | null;
}
