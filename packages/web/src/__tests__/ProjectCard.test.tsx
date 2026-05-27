import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProjectCard from '../components/ProjectCard';
import type { Project } from '../types/project';

const baseProject: Project = {
  id: '1',
  name: 'test-project',
  description: 'A test project',
  path: '/tmp/test',
  readme: null,
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const noop = {
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onStatusChange: vi.fn(),
  onClick: vi.fn(),
};

describe('ProjectCard', () => {
  it('renders project name and description for ACTIVE status', () => {
    render(<ProjectCard project={baseProject} {...noop} />);
    expect(screen.getByText('test-project')).toBeInTheDocument();
    expect(screen.getByText('A test project')).toBeInTheDocument();
    expect(screen.getByText('活跃')).toBeInTheDocument();
  });

  it('renders ERROR badge and warning message for ERROR status', () => {
    const errorProject = { ...baseProject, status: 'ERROR' as const };
    render(<ProjectCard project={errorProject} {...noop} />);
    expect(screen.getByText('异常')).toBeInTheDocument();
    expect(screen.getByText('项目目录不存在，请检查路径或删除项目')).toBeInTheDocument();
  });

  it('shows edit and archive buttons for ACTIVE status', () => {
    render(<ProjectCard project={baseProject} {...noop} />);
    expect(screen.getByText('编辑')).toBeInTheDocument();
    expect(screen.getByText('归档')).toBeInTheDocument();
  });

  it('hides edit and archive buttons for ERROR status', () => {
    const errorProject = { ...baseProject, status: 'ERROR' as const };
    render(<ProjectCard project={errorProject} {...noop} />);
    expect(screen.queryByText('编辑')).not.toBeInTheDocument();
    expect(screen.queryByText('归档')).not.toBeInTheDocument();
  });

  it('always shows delete button regardless of status', () => {
    const errorProject = { ...baseProject, status: 'ERROR' as const };
    render(<ProjectCard project={errorProject} {...noop} />);
    const deleteBtn = screen.getByTitle('删除');
    expect(deleteBtn).toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<ProjectCard project={baseProject} {...noop} onClick={onClick} />);
    fireEvent.click(screen.getByText('test-project'));
    expect(onClick).toHaveBeenCalledWith(baseProject);
  });

  it('shows restore button for ARCHIVED status', () => {
    const archivedProject = { ...baseProject, status: 'ARCHIVED' as const };
    render(<ProjectCard project={archivedProject} {...noop} />);
    expect(screen.getByText('恢复')).toBeInTheDocument();
  });

  it('stopPropagation on edit button click does not trigger card onClick', () => {
    const onClick = vi.fn();
    const onEdit = vi.fn();
    render(<ProjectCard project={baseProject} {...noop} onClick={onClick} onEdit={onEdit} />);
    fireEvent.click(screen.getByText('编辑'));
    expect(onEdit).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });
});
