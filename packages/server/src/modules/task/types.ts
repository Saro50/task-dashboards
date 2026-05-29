export interface ImportTaskPlanRequest {
  topic: string;
  summary: string;
  tasks: {
    ref: string;
    title: string;
    description: string;
    dependencies: string[];
  }[];
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
}
