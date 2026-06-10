import { apiRequest } from '@/api/lib';
import type { Step, CreateStepInput, UpdateStepInput, StepPlanItem, ImportStepPlanResponse } from '@/types/step';

const BASE = '/api';
const S = 'stepApi';

export const stepApi = {
  list(projectId: string): Promise<{ steps: Step[] }> {
    return apiRequest<{ steps: Step[] }>(S, `${BASE}/projects/${projectId}/steps`);
  },

  listByTask(taskId: string): Promise<{ steps: Step[] }> {
    return apiRequest<{ steps: Step[] }>(S, `${BASE}/tasks/${taskId}/steps`);
  },

  importPlan(
    projectId: string,
    task: string,
    summary: string,
    steps: StepPlanItem[],
    options?: { chatSessionId?: string; taskId?: string },
  ): Promise<ImportStepPlanResponse> {
    return apiRequest<ImportStepPlanResponse>(S, `${BASE}/projects/${projectId}/steps/import`, {
      method: 'POST',
      body: JSON.stringify({
        task,
        summary,
        steps,
        chatSessionId: options?.chatSessionId,
        taskId: options?.taskId,
      }),
    });
  },

  getImportedPlans(sessionId: string): Promise<Array<{ planHash: string; taskName: string; projectId: string; taskId: string | null }>> {
    return apiRequest<Array<{ planHash: string; taskName: string; projectId: string; taskId: string | null }>>(
      S,
      `${BASE}/chat-sessions/${sessionId}/imported-plans`,
    );
  },

  create(projectId: string, input: CreateStepInput): Promise<Step> {
    return apiRequest<Step>(S, `${BASE}/projects/${projectId}/steps`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(stepId: string, input: UpdateStepInput): Promise<Step> {
    return apiRequest<Step>(S, `${BASE}/steps/${stepId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  remove(stepId: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/steps/${stepId}`, { method: 'DELETE' });
  },

  addDependency(stepId: string, dependsOnId: string): Promise<{ id: string }> {
    return apiRequest<{ id: string }>(S, `${BASE}/steps/${stepId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnId }),
    });
  },

  removeDependency(stepId: string, depId: string): Promise<void> {
    return apiRequest<void>(S, `${BASE}/steps/${stepId}/dependencies/${depId}`, { method: 'DELETE' });
  },
};
