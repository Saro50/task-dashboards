import { useState, useEffect, type FormEvent } from 'react';
import { engineApi } from '@/api/engine';
import type { OpencodeHealth, OpencodeAgent, OpencodeProvidersResponse } from '@/types/engine';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function EngineConfigModal({ open, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [testing, setTesting] = useState(false);
  const [healthResult, setHealthResult] = useState<OpencodeHealth | null>(null);
  const [agents, setAgents] = useState<OpencodeAgent[] | null>(null);
  const [providers, setProviders] = useState<OpencodeProvidersResponse | null>(null);
  const [testError, setTestError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      setHealthResult(null);
      setAgents(null);
      setProviders(null);
      setTestError('');
      setSaving(false);
      engineApi.getConfig().then((c) => setBaseUrl(c.baseUrl)).catch(() => setBaseUrl(''));
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim()) {
      setError('请输入 Opencode Server 地址');
      return;
    }
    try {
      new URL(baseUrl.trim());
    } catch {
      setError('请输入有效的 URL');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await engineApi.upsertConfig({ baseUrl: baseUrl.trim() });
      onClose();
    } catch (err: any) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setHealthResult(null);
    setAgents(null);
    setProviders(null);
    setTestError('');
    try {
      if (baseUrl.trim()) {
        await engineApi.upsertConfig({ baseUrl: baseUrl.trim() });
      }
      const [health, agentList, providerList] = await Promise.allSettled([
        engineApi.healthCheck(),
        engineApi.listAgents(),
        engineApi.listProviders(),
      ]);
      const anySuccess = health.status === 'fulfilled' || agentList.status === 'fulfilled' || providerList.status === 'fulfilled';
      if (health.status === 'fulfilled') setHealthResult(health.value);
      if (agentList.status === 'fulfilled') setAgents(agentList.value);
      if (providerList.status === 'fulfilled') setProviders(providerList.value);
      if (!anySuccess) {
        setTestError(health.reason?.message || agentList.reason?.message || providerList.reason?.message || '连接失败');
      }
    } catch (err: any) {
      setTestError(err.message || '测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-dark-300 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-[scaleIn_0.2s_ease_both]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <span className="font-bold text-white">Agent 引擎配置</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors cursor-pointer">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Opencode Server 地址
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如: http://localhost:4096"
              className="w-full bg-dark-50 border border-gray-600 rounded-xl text-white text-sm px-4 py-3 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all placeholder-gray-500"
              disabled={saving}
            />
            <p className="text-xs text-gray-500 mt-1.5">Opencode AI 服务的连接地址，配置后可获取可用的 Agent 和 Provider</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleTest}
              disabled={testing || !baseUrl.trim()}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-2.5 px-4 rounded-xl transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {testing ? '测试中...' : '测试连接'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>

          {testError && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-2 text-sm text-red-300">
              {testError}
            </div>
          )}

          {healthResult && (
            <div className="bg-green-900/20 border border-green-700/40 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-green-400">✓</span>
                <span className="text-green-300 text-sm font-semibold">连接成功</span>
                {healthResult.config?.model && (
                  <span className="text-xs text-green-400/70 ml-auto">{String(healthResult.config.model)}</span>
                )}
              </div>
            </div>
          )}

          {agents && agents.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-2">可用 Agent（{agents.length}）</h4>
              <div className="flex flex-col gap-1.5">
                {agents.map((agent, i) => (
                  <div key={agent.id ?? i} className="bg-dark-50 border border-gray-700 rounded-lg px-3 py-2 text-xs">
                    <span className="text-white font-medium">{agent.name}</span>
                    {agent.description && <span className="text-gray-500 ml-2">{agent.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {providers && (
            <div>
              <h4 className="text-sm font-semibold text-gray-300 mb-2">Provider</h4>
              <div className="flex flex-col gap-1.5">
                {providers.providers.map((p, i) => (
                  <div key={p.id ?? i} className="bg-dark-50 border border-gray-700 rounded-lg px-3 py-2 text-xs">
                    <span className="text-white font-medium">{p.name}</span>
                    {p.models.length > 0 && (
                      <span className="text-gray-500 ml-2">{p.models.join(', ')}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
