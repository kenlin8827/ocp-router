import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ShieldAlert, RefreshCw, Search } from 'lucide-react';
import { api, type GatewayStatusResponse, type BreakerInfo } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';
import { useToast } from '../components/ToastProvider';
import { Pagination } from '../components/Pagination';

const BREAKER_PAGE_SIZE = 20;
const BREAKER_PAGE_SIZES = [10, 20, 50, 100, 200];

export const GuardrailsPage: React.FC = () => {
  const { status } = useOutletContext<{ status: GatewayStatusResponse | null }>();
  const { t } = useI18n();
  const toast = useToast();
  const [modelFilter, setModelFilter] = useState('');
  const [breakerPage, setBreakerPage] = useState(1);
  const [breakerPageSize, setBreakerPageSize] = useState(BREAKER_PAGE_SIZE);
  const [isResetting, setIsResetting] = useState(false);

  const breakers: BreakerInfo[] = status?.circuitBreakers?.breakers || [];
  const openCount = status?.circuitBreakers?.openCount || 0;
  const totalBreakers = status?.circuitBreakers?.total || 95;

  const filteredBreakers = breakers.filter(b =>
    b.model.toLowerCase().includes(modelFilter.toLowerCase())
  );
  const pagedBreakers = filteredBreakers.slice(
    (breakerPage - 1) * breakerPageSize,
    breakerPage * breakerPageSize
  );

  const handleResetAll = async () => {
    setIsResetting(true);
    try {
      await api.resetBreakers();
      toast.success(t('guardrails.resetSuccess'));
    } catch (err: any) {
      toast.error('Failed: ' + err.message);
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
        <div className="card">
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>{t('guardrails.totalBreakers')}</div>
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{totalBreakers}</div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>{t('guardrails.totalBreakersSub')}</div>
        </div>

        <div className="card">
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>{t('guardrails.openBreakers')}</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: openCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}>
            {openCount}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
            {openCount > 0 ? t('guardrails.openSubTripped') : t('guardrails.openSubSafe')}
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>{t('guardrails.budgetTitle')}</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--accent)' }}>
            ${status?.budget?.currentSpendUsd?.toFixed(2) || '0.00'} / ${status?.budget?.monthlyLimitUsd?.toFixed(2) || '50.00'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
            {t('guardrails.budgetSub')}
          </div>
        </div>
      </div>

      {/* Circuit Breaker Matrix */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <ShieldAlert size={18} color="var(--accent-rose)" />
            <span>{t('guardrails.title')}</span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-primary" onClick={handleResetAll} disabled={isResetting}>
              <RefreshCw size={13} />
              <span>{isResetting ? t('guardrails.resetting') : t('guardrails.resetAll')}</span>
            </button>
          </div>
        </div>

        {/* Filter Input */}
        <div style={{ marginBottom: '16px', position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
          <input
            type="text"
            value={modelFilter}
            onChange={e => { setModelFilter(e.target.value); setBreakerPage(1); }}
            placeholder={t('guardrails.searchFilter')}
            className="input"
            style={{ paddingLeft: '34px' }}
          />
        </div>

        {/* Matrix Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', maxHeight: '560px', overflowY: 'auto' }}>
          {pagedBreakers.length > 0 ? (
            pagedBreakers.map(b => {
              const isClosed = b.state === 'CLOSED';
              const isOpen = b.state === 'OPEN';
              return (
                <div
                  key={b.model}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--card-border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', fontFamily: 'JetBrains Mono, monospace' }}>
                      {b.model}
                    </span>
                    <span className={`badge ${isClosed ? 'badge-success' : isOpen ? 'badge-danger' : 'badge-warning'}`}>
                      {b.state}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)' }}>
                    <span>{t('guardrails.failures', { count: b.failures })}</span>
                    {b.cooldownRemainingMs > 0 && (
                      <span style={{ color: 'var(--accent-amber)' }}>
                        {t('guardrails.cooldown', { sec: Math.round(b.cooldownRemainingMs / 1000) })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', gridColumn: '1 / -1' }}>
              {t('guardrails.noMatch')}
            </div>
          )}
        </div>
        <Pagination
          page={breakerPage}
          pageSize={breakerPageSize}
          total={filteredBreakers.length}
          onChange={setBreakerPage}
          pageSizeOptions={BREAKER_PAGE_SIZES}
          onPageSizeChange={(s) => { setBreakerPageSize(s); setBreakerPage(1); }}
        />
      </div>
    </div>
  );
};
