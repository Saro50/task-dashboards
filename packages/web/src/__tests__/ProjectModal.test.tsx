import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectModal from '../components/ProjectModal';

vi.mock('../api/project', () => ({
  projectApi: {
    checkDirectory: vi.fn(),
    ensureDirectory: vi.fn(),
  },
}));

import { projectApi } from '../api/project';

const defaultProps = {
  open: true,
  project: null,
  onClose: vi.fn(),
  onSubmit: vi.fn(),
};

describe('ProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when open=false', () => {
    render(<ProjectModal {...defaultProps} open={false} />);
    expect(screen.queryByText('新建项目')).not.toBeInTheDocument();
  });

  it('renders create modal when open=true', () => {
    render(<ProjectModal {...defaultProps} />);
    expect(screen.getByText('新建项目')).toBeInTheDocument();
  });

  it('shows error when submitting without name', async () => {
    const onSubmit = vi.fn();
    render(<ProjectModal {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('创建项目'));
    expect(screen.getByText('请输入项目名称')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error for invalid name characters', async () => {
    render(<ProjectModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText('例如: my-awesome-app');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(nameInput, 'invalid name!');
    fireEvent.click(screen.getByText('创建项目'));
    expect(screen.getByText('项目名称仅支持字母、数字、连字符和下划线')).toBeInTheDocument();
  });

  it('blocks submit and shows error when directory does not exist', async () => {
    const onSubmit = vi.fn();
    (projectApi.checkDirectory as any).mockResolvedValue({
      exists: false,
      isGitRepo: false,
      absolutePath: '/tmp/nonexistent',
    });
    render(<ProjectModal {...defaultProps} onSubmit={onSubmit} />);

    const nameInput = screen.getByPlaceholderText('例如: my-awesome-app');
    const pathInput = screen.getByPlaceholderText('例如: ~/projects/my-app');

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(nameInput, 'my-project');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(pathInput, '/tmp/nonexistent');

    await waitFor(() => {
      expect(projectApi.checkDirectory).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('目录不存在，请确认路径')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('创建项目'));
    const errorMessages = screen.getAllByText('目录不存在，请确认路径');
    expect(errorMessages.length).toBeGreaterThanOrEqual(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls ensureDirectory before onSubmit when directory exists without git', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    (projectApi.checkDirectory as any).mockResolvedValue({
      exists: true,
      isGitRepo: false,
      absolutePath: '/tmp/no-git',
    });
    (projectApi.ensureDirectory as any).mockResolvedValue({
      exists: true,
      isGitRepo: true,
      absolutePath: '/tmp/no-git',
    });

    render(<ProjectModal {...defaultProps} onSubmit={onSubmit} />);

    const nameInput = screen.getByPlaceholderText('例如: my-awesome-app');
    const pathInput = screen.getByPlaceholderText('例如: ~/projects/my-app');

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(nameInput, 'my-project');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(pathInput, '/tmp/no-git');

    await waitFor(() => {
      expect(projectApi.checkDirectory).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('目录已存在，创建项目后将自动初始化 Git')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('创建项目'));

    await waitFor(() => {
      expect(projectApi.ensureDirectory).toHaveBeenCalledWith('/tmp/no-git');
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it('submits directly when directory exists with git', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    (projectApi.checkDirectory as any).mockResolvedValue({
      exists: true,
      isGitRepo: true,
      absolutePath: '/tmp/has-git',
    });

    render(<ProjectModal {...defaultProps} onSubmit={onSubmit} />);

    const nameInput = screen.getByPlaceholderText('例如: my-awesome-app');
    const pathInput = screen.getByPlaceholderText('例如: ~/projects/my-app');

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(nameInput, 'my-project');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(pathInput, '/tmp/has-git');

    await waitFor(() => {
      expect(projectApi.checkDirectory).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('目录已存在，Git 已初始化')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('创建项目'));

    await waitFor(() => {
      expect(projectApi.ensureDirectory).not.toHaveBeenCalled();
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it('renders edit modal when project is provided', () => {
    render(
      <ProjectModal
        {...defaultProps}
        project={{
          id: '1',
          name: 'existing',
          description: 'desc',
          path: '/tmp/existing',
          readme: null,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }}
      />
    );
    expect(screen.getByText('编辑项目')).toBeInTheDocument();
    expect(screen.getByText('保存修改')).toBeInTheDocument();
  });
});
