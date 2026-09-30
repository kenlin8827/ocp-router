import React, { useState, useEffect } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { api, type TraceRecord, type SessionRecord } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';

export const UsagePage: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'traces' | 'sessions'>('traces');
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        api.getTraces(50),
        api.getSessions(),
      ]);
      setTraces(tRes.traces || []);
      setSessions(sRes.sessions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <BarChart3 size={18} color="var(--accent)" />
            <span>{t('usage.title')}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className={`btn btn-sm ${activeTab === 'traces' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('traces')}
            >
              <span>{t('usage.tabTraces', { count: traces.length })}</span>
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'sessions' ? 'btn-primary' : ''}`}
              onClick={() => setActiveTab('sessions')}
            >
              <span>{t('usage.tabSessions', { count: sessions.length })}</span>
            </button>
            <button className="btn btn-sm" onClick={loadData} disabled={loading}>
              <RefreshCw size={12} />
              <span>{t('usage.refresh')}</span>
            </button>
          </div>
        </div>

        {activeTab === 'traces' ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thTraceId')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thTime')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thModel')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thCache')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thTokens')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thCostSaved')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thLatency')}</th>
                </tr>
              </thead>
              <tbody>
                {traces.length > 0 ? (
                  traces.map(tItem => (
                    <tr key={tItem.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
                        {tItem.id.slice(0, 14)}...
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                        {new Date(tItem.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                        <span style={{ color: 'var(--text-dim)', marginRight: '6px' }}>[{tItem.provider}]</span>
                        <span>{tItem.model}</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {tItem.cacheHit ? (
                          <span className="badge badge-success">⚡ HIT</span>
                        ) : (
                          <span className="badge" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-dim)' }}>
                            MISS
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace' }}>
                        {(tItem.tokens?.total || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--accent-emerald)', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}>
                        ${(tItem.costUsd?.savings || 0).toFixed(4)}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace' }}>
                        {tItem.latencyMs} ms
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)' }}>
                      {t('usage.emptyTraces')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--card-border)', color: 'var(--text-dim)' }}>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thSessionId')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thPinned')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thTier')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thTurns')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thTokens')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('usage.thActive')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length > 0 ? (
                  sessions.map(s => (
                    <tr key={s.sessionId} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' }}>
                        {s.sessionId}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{s.pinnedModel}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span className="badge badge-info">Tier {s.currentTier}</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>{s.traceCount}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace' }}>
                        {s.totalTokens.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-dim)' }}>
                        {new Date(s.lastActiveAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)' }}>
                      {t('usage.emptySessions')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
