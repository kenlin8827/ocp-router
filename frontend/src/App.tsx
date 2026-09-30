import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { OverviewPage } from './pages/OverviewPage';
import { ChainsPage } from './pages/ChainsPage';
import { KeysPage } from './pages/KeysPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { GuardrailsPage } from './pages/GuardrailsPage';
import { UsagePage } from './pages/UsagePage';
import { ClientsPage } from './pages/ClientsPage';
import { SettingsPage } from './pages/SettingsPage';
import { YamlPage } from './pages/YamlPage';

export const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="chains" element={<ChainsPage />} />
        <Route path="rules" element={<ChainsPage />} />
        <Route path="cache" element={<ChainsPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="providers" element={<KeysPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="guardrails" element={<GuardrailsPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="yaml" element={<YamlPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
};
