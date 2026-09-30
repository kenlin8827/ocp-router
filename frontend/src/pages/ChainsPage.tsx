import React, { useState, useEffect } from 'react';
import { Layers } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';

export const ChainsPage: React.FC = () => {
  const { t } = useI18n();
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Layers size={18} color="var(--accent)" />
            <span>{t('chains.title')}</span>
          </div>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6', marginBottom: '20px' }}>
          {t('chains.desc')}
        </p>

        {/* 3 Tier Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          {/* Tier 1 */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-emerald)' }}>{t('chains.t1Title')}</div>
              <span className="badge badge-success">{t('chains.t1Badge')}</span>
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>{t('chains.t1Models')}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '14px' }}>
              {t('chains.t1Desc')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>{t('chains.t1Lat')}</div>
              <div>{t('chains.t1Fail')}</div>
            </div>
          </div>

          {/* Tier 2 */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)' }}>{t('chains.t2Title')}</div>
              <span className="badge badge-info">{t('chains.t2Badge')}</span>
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>{t('chains.t2Models')}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '14px' }}>
              {t('chains.t2Desc')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>{t('chains.t2Ratchet')}</div>
              <div>{t('chains.t2Schema')}</div>
            </div>
          </div>

          {/* Tier 3 */}
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--card-border)', borderRadius: '10px', padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-violet)' }}>{t('chains.t3Title')}</div>
              <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-violet)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>{t('chains.t3Badge')}</span>
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>{t('chains.t3Models')}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '14px' }}>
              {t('chains.t3Desc')}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>{t('chains.t3Budget')}</div>
              <div>{t('chains.t3Fallback')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
