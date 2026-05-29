import { useState, useEffect, type FormEvent } from 'react';
import { engineApi } from '@/api/engine';
import type { OpencodeHealth, OpencodeAgent, OpencodeProvidersResponse } from '@/types/engine';
import { log } from '@/utils/log';

const S = 'EngineConfigModal';

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
    log.info(S, 'handleSave', { baseUrl: baseUrl.trim() });
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
    log.info(S, 'handleTest', { baseUrl: baseUrl.trim() });
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
        const errMsg = health.reason?.message || agentList.reason?.message || providerList.reason?.message || '连接失败';
        log.error(S, 'handleTest all failed', { health: health.status, agents: agentList.status, providers: providerList.status, error: errMsg });
        setTestError(errMsg);
      } else {
        log.info(S, 'handleTest success', { health: health.status === 'fulfilled' ? health.value : null, agents: agentList.status === 'fulfilled' ? agentList.value?.length : null, providers: providerList.status === 'fulfilled' ? providerList.value : null });
      }
    } catch (err: any) {
      setTestError(err.message || '测试连接失败');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-[scaleIn_0.2s_ease_both]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-semibold text-gray-800">Agent 引擎配置</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-800 transition-colors cursor-pointer">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Opencode Server 地址
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如: http://localhost:4096"
              className="w-full px-3 py-2.5 text-gray-800 bg-transparent border border-gray-300 shadow-sm rounded-lg text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 transition-all placeholder-gray-400"
              disabled={saving}
            />
            <p className="text-xs text-gray-400 mt-1.5">Opencode AI 服务的连接地址，配置后可获取可用的 Agent 和 Provider</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleTest}
              disabled={testing || !baseUrl.trim()}
              className="flex-1 border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium py-2.5 px-4 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {testing ? '测试中...' : '测试连接'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow cursor-pointer"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>

          {testError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
              {testError}
            </div>
          )}

          {healthResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-green-600 text-sm font-medium">连接成功</span>
              </div>
            </div>
          )}

          {agents && agents.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">可用 Agent（{agents.length}）</h4>
              <div className="flex flex-col gap-1.5">
                {agents.map((agent, i) => (
                  <div key={agent.id ?? i} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">
                    <span className="text-gray-800 font-medium">{agent.name}</span>
                    {agent.description && <span className="text-gray-500 ml-2">{agent.description}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {providers && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Provider</h4>
              <div className="flex flex-col gap-1.5">
                {providers.providers.map((p, i) => (
                  <div key={p.id ?? i} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs">
                    <span className="text-gray-800 font-medium">{p.name}</span>
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
