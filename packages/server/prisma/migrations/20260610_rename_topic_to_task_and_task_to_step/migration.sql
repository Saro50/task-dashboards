-- 迁移：主题(Topic) → 任务(Task)，任务(Task) → 步骤(Step)

-- 1. 将旧 "Task" 表（原任务表）重命名为 "Step"，字段 topicId → taskId
ALTER TABLE "Task" RENAME TO "Step";
ALTER TABLE "Step" RENAME COLUMN "topicId" TO "taskId";

-- 2. 重命名 TaskTopic → Task
ALTER TABLE "TaskTopic" RENAME TO "Task";

-- 3. Step 表：重命名约束和索引
ALTER TABLE "Step" RENAME CONSTRAINT "Task_pkey" TO "Step_pkey";
ALTER TABLE "Step" RENAME CONSTRAINT "Task_topicId_fkey" TO "Step_taskId_fkey";
ALTER TABLE "Step" DROP CONSTRAINT "Task_projectId_fkey";
ALTER TABLE "Step" ADD CONSTRAINT "Step_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "Task_projectId_idx";
DROP INDEX "Task_status_idx";
DROP INDEX "Task_topicId_idx";
CREATE INDEX "Step_projectId_idx" ON "Step"("projectId");
CREATE INDEX "Step_status_idx" ON "Step"("status");
CREATE INDEX "Step_taskId_idx" ON "Step"("taskId");

-- 4. Task（原 TaskTopic）表：重命名约束和索引
ALTER TABLE "Task" RENAME CONSTRAINT "TaskTopic_pkey" TO "Task_pkey";
ALTER TABLE "Task" RENAME CONSTRAINT "TaskTopic_projectId_fkey" TO "Task_projectId_fkey";
DROP INDEX "TaskTopic_projectId_idx";
CREATE INDEX "Task_projectId_idx" ON "Task"("projectId");

-- 5. 重命名 TaskCommit → StepCommit
ALTER TABLE "TaskCommit" RENAME TO "StepCommit";
ALTER TABLE "StepCommit" RENAME COLUMN "taskId" TO "stepId";
ALTER TABLE "StepCommit" RENAME CONSTRAINT "TaskCommit_pkey" TO "StepCommit_pkey";
ALTER TABLE "StepCommit" DROP CONSTRAINT "TaskCommit_taskId_fkey";
ALTER TABLE "StepCommit" DROP CONSTRAINT "TaskCommit_executionId_fkey";
ALTER TABLE "StepCommit" ADD CONSTRAINT "StepCommit_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepCommit" ADD CONSTRAINT "StepCommit_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "TaskExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "TaskCommit_taskId_executionId_key";
CREATE UNIQUE INDEX "StepCommit_stepId_executionId_key" ON "StepCommit"("stepId", "executionId");
DROP INDEX "TaskCommit_executionId_idx";
CREATE INDEX "StepCommit_executionId_idx" ON "StepCommit"("executionId");

-- 6. 重命名 TaskDependency → StepDependency
ALTER TABLE "TaskDependency" RENAME TO "StepDependency";
ALTER TABLE "StepDependency" RENAME COLUMN "taskId" TO "stepId";
ALTER TABLE "StepDependency" RENAME CONSTRAINT "TaskDependency_pkey" TO "StepDependency_pkey";
ALTER TABLE "StepDependency" DROP CONSTRAINT "TaskDependency_taskId_fkey";
ALTER TABLE "StepDependency" DROP CONSTRAINT "TaskDependency_dependsOnId_fkey";
ALTER TABLE "StepDependency" ADD CONSTRAINT "StepDependency_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepDependency" ADD CONSTRAINT "StepDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Step"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "TaskDependency_taskId_dependsOnId_key";
CREATE UNIQUE INDEX "StepDependency_stepId_dependsOnId_key" ON "StepDependency"("stepId", "dependsOnId");
DROP INDEX "TaskDependency_taskId_idx";
DROP INDEX "TaskDependency_dependsOnId_idx";
CREATE INDEX "StepDependency_stepId_idx" ON "StepDependency"("stepId");
CREATE INDEX "StepDependency_dependsOnId_idx" ON "StepDependency"("dependsOnId");

-- 7. 重命名枚举 TaskStatus → StepStatus
ALTER TYPE "TaskStatus" RENAME TO "StepStatus";

-- 8. 修改 TaskExecution 表字段
ALTER TABLE "TaskExecution" RENAME COLUMN "topicId" TO "taskId";
ALTER TABLE "TaskExecution" RENAME COLUMN "completedTasks" TO "completedSteps";
ALTER TABLE "TaskExecution" RENAME COLUMN "totalTasks" TO "totalSteps";
ALTER TABLE "TaskExecution" DROP CONSTRAINT "TaskExecution_topicId_fkey";
ALTER TABLE "TaskExecution" ADD CONSTRAINT "TaskExecution_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX "TaskExecution_topicId_idx";
CREATE INDEX "TaskExecution_taskId_idx" ON "TaskExecution"("taskId");

-- 9. 修改 PlanImport 表字段
ALTER TABLE "PlanImport" RENAME COLUMN "topicName" TO "taskName";
ALTER TABLE "PlanImport" RENAME COLUMN "topicId" TO "taskId";
