import { useCallback } from 'react';
import { BaseEdge, getBezierPath, EdgeLabelRenderer } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { stepApi } from '@/api/step';
import { log } from '@/utils/log';

const S = 'StepEdge';

export default function TaskEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  source,
  target,
  data,
}: EdgeProps) {
  const d = data as Record<string, any> | undefined;
  const hovered = d?.hovered as boolean | undefined;
  const onDeleted = d?.onDeleted as (() => void) | undefined;
  const deleting = d?.deleting as boolean | undefined;
  const disabled = d?.disabled as boolean | undefined;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleting || disabled) return;
    log.info(S, 'handleDelete', { source: source as string, target: target as string });
    d?.onDeleteClick?.();
    try {
      await stepApi.removeDependency(target as string, source as string);
      log.info(S, 'handleDelete success');
      onDeleted?.();
    } catch (err: any) {
      log.error(S, 'handleDelete error', err);
      alert(err.message || '删除失败');
    }
  }, [source, target, onDeleted, deleting, disabled, d]);

  const isActive = !disabled && (hovered || selected);
  const stroke = isActive ? '#0ea5e9' : '#9ca3af';
  const strokeWidth = isActive ? 2 : 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd="url(#task-arrow)"
        style={{ stroke, strokeWidth }}
      />
      {isActive && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              onClick={handleDelete}
              className="w-5 h-5 flex items-center justify-center rounded-full bg-white border border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs leading-none"
            >
              ×
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
