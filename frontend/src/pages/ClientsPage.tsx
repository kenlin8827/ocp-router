import React, { useState, useEffect } from 'react';
import { Terminal, Check, RefreshCw, Undo2, ArrowUpRight } from 'lucide-react';
import { api, type ClientStatus } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';
import { useToast } from '../components/ToastProvider';

export const ClientsPage: React.FC = () => {
  const { t } = useI18n();
  const toast = useToast();
  const [clients, setClients] = useState<ClientStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadClients = async () => {
    try {
      const data = await api.getStatus();
      setClients(data.clients || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  const handleToggle = async (clientName: string, action: 'setup' | 'teardown') => {
    setLoading(true);
    try {
      const res = await api.toggleClient(clientName, action);
      setActionNotice(res.message || 'Updated');
      await loadClients();
      setTimeout(() => setActionNotice(null), 3000);
    } catch (err: any) {
      toast.error('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Terminal size={18} color="var(--accent)" />
            <span>{t('clients.title')}</span>
          </div>
          <button className="btn btn-sm" onClick={loadClients} disabled={loading}>
            <RefreshCw size={12} />
            <span>{t('clients.refresh')}</span>
          </button>
        </div>

        {actionNotice && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--accent-emerald)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Check size={16} />
            <span>{actionNotice}</span>
          </div>
        )}

        <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '20px' }}>
          {t('clients.desc')}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
          {clients.map(c => (
            <div
              key={c.name}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--card-border)',
                borderRadius: '10px',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '16px',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 700 }}>{c.displayName}</span>
                  {c.hooked ? (
                    <span className="badge badge-success">{t('overview.hooked')}</span>
                  ) : (
                    <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>
                      {t('overview.notHooked')}
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '10px' }}>
                  {t('clients.configPath')}
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: '3px' }}>
                    {c.configPath}
                  </div>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                  <div>{t('clients.fileExists')} {c.exists ? t('clients.yes') : t('clients.no')}</div>
                  <div>{t('clients.backupExists')} {c.backupExists ? t('clients.ready') : t('clients.none')}</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--card-border)', paddingTop: '12px' }}>
                {c.hooked ? (
                  <button
                    className="btn btn-danger btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleToggle(c.name, 'teardown')}
                    disabled={loading}
                  >
                    <Undo2 size={12} />
                    <span>{t('clients.teardownBtn')}</span>
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => handleToggle(c.name, 'setup')}
                    disabled={loading}
                  >
                    <ArrowUpRight size={12} />
                    <span>{t('clients.setupBtn')}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
