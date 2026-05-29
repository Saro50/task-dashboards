import { useState, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import Layout from './components/Layout';
import type { EngineStatus } from './components/Layout';
import ProjectListPage from './pages/ProjectListPage';
import TopicGraphPage from './pages/TopicGraphPage';
import TaskGraphPage from './pages/TaskGraphPage';
import EngineConfigModal from './components/EngineConfigModal';
import { ToastProvider, useToast } from './components/Toast';
import { engineApi } from './api/engine';

function AppContent() {
  const { showToast } = useToast();
  const [engineConfigOpen, setEngineConfigOpen] = useState(false);
  const [engineStatus, setEngineStatus] = useState<EngineStatus>('disconnected');

  const checkEngineStatus = useCallback(async () => {
    try {
      await engineApi.healthCheck();
      setEngineStatus('connected');
    } catch {
      try {
        await engineApi.getConfig();
        setEngineStatus('error');
      } catch {
        setEngineStatus('disconnected');
      }
    }
  }, []);

  useEffect(() => {
    checkEngineStatus();
  }, [checkEngineStatus]);

  return (
    <Layout onOpenEngineConfig={() => setEngineConfigOpen(true)} engineStatus={engineStatus}>
      <Routes>
        <Route path="/" element={<ProjectListPage onOpenEngineConfig={() => setEngineConfigOpen(true)} engineStatus={engineStatus} onEngineStatusChange={checkEngineStatus} />} />
        <Route path="/project/:projectId" element={<TopicGraphPage engineStatus={engineStatus} />} />
        <Route path="/project/:projectId/topic/:topicId" element={<TaskGraphPage engineStatus={engineStatus} />} />
      </Routes>

      <EngineConfigModal
        open={engineConfigOpen}
        onClose={() => { setEngineConfigOpen(false); checkEngineStatus(); }}
      />
    </Layout>
  );
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
