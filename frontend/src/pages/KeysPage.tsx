import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Activity, Check, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';

interface ProviderItem {
  id: string;
  defaultBaseUrl: string;
  type: string;
}

const PRESET_PROVIDERS: ProviderItem[] = [
  { id: 'deepseek', defaultBaseUrl: 'https://api.deepseek.com/v1', type: 'openai-compatible' },
  { id: 'openai', defaultBaseUrl: 'https://api.openai.com/v1', type: 'openai-compatible' },
  { id: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com', type: 'anthropic' },
  { id: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', type: 'openai-compatible' },
  { id: 'siliconflow', defaultBaseUrl: 'https://api.siliconflow.cn/v1', type: 'openai-compatible' },
  { id: 'openrouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', type: 'openai-compatible' },
];

export const KeysPage: React.FC = () => {
  const { t } = useI18n();
  const [providerState, setProviderState] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [pingResults, setPingResults] = useState<Record<string, { ok: boolean; latencyMs: number; testing: boolean; err?: string }>>({});
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    api.getConfig().then(cfg => {
      const initial: Record<string, { apiKey: string; baseUrl: string }> = {};
      PRESET_PROVIDERS.forEach(p => {
        const found = cfg?.models?.find((m: any) => m.provider?.toLowerCase() === p.id);
        initial[p.id] = {
          apiKey: found?.apiKey || '',
          baseUrl: found?.baseUrl || p.defaultBaseUrl,
        };
      });
      setProviderState(initial);
    }).catch(console.error);
  }, []);

  const handleToggleEye = (id: string) => {
    setVisibility(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleFieldChange = (id: string, field: 'apiKey' | 'baseUrl', val: string) => {
    setProviderState(prev => ({
      ...prev,
      [id]: {
        ...(prev[id] || { apiKey: '', baseUrl: '' }),
        [field]: val,
      },
    }));
  };

  const handleTestPing = async (id: string) => {
    const item = providerState[id];
    if (!item?.apiKey) {
      alert(t('keys.promptEnterKey'));
      return;
    }

    setPingResults(prev => ({ ...prev, [id]: { ok: false, latencyMs: 0, testing: true } }));
    try {
      const res = await api.testProviderPing(item.baseUrl, item.apiKey);
      setPingResults(prev => ({
        ...prev,
        [id]: { ok: res.ok, latencyMs: res.latencyMs, testing: false, err: res.error },
      }));
    } catch (err: any) {
      setPingResults(prev => ({
        ...prev,
        [id]: { ok: false, latencyMs: 0, testing: false, err: err.message },
      }));
    }
  };

  const handleSaveAll = async () => {
    try {
      await api.saveProviderKeys(providerState);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Key size={18} color="var(--accent)" />
            <span>{t('keys.title')}</span>
          </div>
          <button className="btn btn-primary" onClick={handleSaveAll}>
            <Save size={14} />
            <span>{t('keys.saveAll')}</span>
          </button>
        </div>

        {savedNotice && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--accent-emerald)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Check size={16} />
            <span>{t('keys.savedSuccess')}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '18px' }}>
          {PRESET_PROVIDERS.map(p => {
            const data = providerState[p.id] || { apiKey: '', baseUrl: p.defaultBaseUrl };
            const isVisible = visibility[p.id];
            const ping = pingResults[p.id];

            return (
              <div
                key={p.id}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--card-border)',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{t(`keys.providers.${p.id}`)}</span>
                  </div>
                  <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>
                    {p.type}
                  </span>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px', display: 'block' }}>
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={data.baseUrl}
                    onChange={e => handleFieldChange(p.id, 'baseUrl', e.target.value)}
                    className="input"
                    style={{ fontSize: '12px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '4px', display: 'block' }}>
                    API Key
                  </label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={data.apiKey}
                      onChange={e => handleFieldChange(p.id, 'apiKey', e.target.value)}
                      placeholder={t('keys.keyPlaceholder', { env: `${p.id.toUpperCase()}_API_KEY` })}
                      className="input"
                      style={{ fontSize: '12px', paddingRight: '36px' }}
                    />
                    <div
                      onClick={() => handleToggleEye(p.id)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        cursor: 'pointer',
                        color: 'var(--text-dim)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                    </div>
                  </div>
                </div>

                {/* Probe Ping Action & Latency Result */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => handleTestPing(p.id)}
                    disabled={ping?.testing}
                  >
                    <Activity size={12} />
                    <span>{ping?.testing ? t('keys.testing') : t('keys.testPing')}</span>
                  </button>

                  {ping && !ping.testing && (
                    <div style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
                      {ping.ok ? (
                        <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                          {t('keys.pingOk', { ms: ping.latencyMs })}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }} title={ping.err}>
                          {t('keys.pingFailed')} ({ping.err ? ping.err.slice(0, 15) : 'Error'})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
