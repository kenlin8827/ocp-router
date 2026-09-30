import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Cpu, RefreshCw, Search, Brain, Wrench } from 'lucide-react';
import { opencodeApi, type OpenCodeModelView } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';

type SortKey = 'default' | 'priceAsc' | 'priceDesc' | 'contextDesc' | 'name';

const PAGE_SIZE = 200;

/** 200000 → "200K", 1000000 → "1M" */
const fmtContext = (n?: number): string => {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `${Number.isInteger(n / 1_000_000) ? n / 1_000_000 : (n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
};

const fmtPrice = (v?: number): string =>
  typeof v === 'number' && v >= 0 ? `$${v.toFixed(2)}` : '—';

const badgeStyle = (color: string, bg: string): React.CSSProperties => ({
  background: bg,
  color,
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: '99px',
  border: `1px solid ${bg}`,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
});

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid var(--card-border)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '9px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  verticalAlign: 'top',
};

export const ModelsPage: React.FC = () => {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();

  const [models, setModels] = useState<OpenCodeModelView[]>([]);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState(searchParams.get('provider') || '');
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [sort, setSort] = useState<SortKey>('default');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const load = async () => {
    setLoading(true);
    try {
      const res = await opencodeApi.listModels();
      setModels(res.models);
      setSource(res.source);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerOptions = useMemo(() => {
    const map = new Map<string, { id: string; name?: string; connected: boolean; count: number }>();
    for (const m of models) {
      const e = map.get(m.providerId);
      if (e) e.count += 1;
      else map.set(m.providerId, { id: m.providerId, name: m.providerName, connected: m.connected, count: 1 });
    }
    return Array.from(map.values()).sort(
      (a, b) => Number(b.connected) - Number(a.connected) || (a.name || a.id).localeCompare(b.name || b.id)
    );
  }, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = models.filter((m) => {
      if (onlyConnected && !m.connected) return false;
      if (provider && m.providerId !== provider) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q) ||
        (m.providerName || '').toLowerCase().includes(q)
      );
    });
    const price = (m: OpenCodeModelView) =>
      typeof m.pricing?.input === 'number' && m.pricing.input >= 0 ? m.pricing.input : Infinity;
    switch (sort) {
      case 'priceAsc':
        list = [...list].sort((a, b) => price(a) - price(b));
        break;
      case 'priceDesc':
        list = [...list].sort((a, b) => price(b) - price(a));
        break;
      case 'contextDesc':
        list = [...list].sort((a, b) => (b.contextLimit || 0) - (a.contextLimit || 0));
        break;
      case 'name':
        list = [...list].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        break;
    }
    return list;
  }, [models, query, provider, onlyConnected, sort]);

  const selectProvider = (id: string) => {
    setProvider(id);
    setVisible(PAGE_SIZE);
    setSearchParams(id ? { provider: id } : {}, { replace: true });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Cpu size={18} color="var(--accent)" />
          <span style={{ fontWeight: 700, fontSize: 15 }}>{t('models.title')}</span>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '0 0 16px' }}>
          {t('models.desc')}
          {source && <span> · {t('models.source', { source })}</span>}
        </p>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.3)', color: 'var(--accent-rose)', fontSize: '13px', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        {/* ---- Toolbar ---- */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }} />
            <input
              className="input"
              style={{ fontSize: 12, paddingLeft: 30, width: '100%' }}
              placeholder={t('models.search')}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisible(PAGE_SIZE); }}
            />
          </div>
          <select
            className="input"
            style={{ fontSize: 12, width: 'auto', cursor: 'pointer' }}
            value={provider}
            onChange={(e) => selectProvider(e.target.value)}
          >
            <option value="">{t('models.filterAll')}</option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id} ({p.count}){p.connected ? '' : ' ·'}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ fontSize: 12, width: 'auto', cursor: 'pointer' }}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="default">{t('models.sortDefault')}</option>
            <option value="priceAsc">{t('models.sortPriceAsc')}</option>
            <option value="priceDesc">{t('models.sortPriceDesc')}</option>
            <option value="contextDesc">{t('models.sortContextDesc')}</option>
            <option value="name">{t('models.sortName')}</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={onlyConnected}
              onChange={(e) => setOnlyConnected(e.target.checked)}
            />
            {t('models.onlyConnected')}
          </label>
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={12} />
            <span>{t('models.refresh')}</span>
          </button>
        </div>

        {/* ---- Table ---- */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('models.thModel')}</th>
                <th style={thStyle}>{t('models.thProvider')}</th>
                <th style={thStyle}>{t('models.thContext')}</th>
                <th style={thStyle}>{t('models.thInput')}</th>
                <th style={thStyle}>{t('models.thOutput')}</th>
                <th style={thStyle}>{t('models.thCapabilities')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visible).map((m) => (
                <tr key={`${m.providerId}/${m.id}`}>
                  <td style={tdStyle}>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, wordBreak: 'break-all' }}>{m.id}</div>
                    {m.name && m.name !== m.id && (
                      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', marginTop: 2 }}>{m.name}</div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {m.providerId}
                    {!m.connected && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)' }} title={t('models.notConnected')}>○</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{fmtContext(m.contextLimit)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', color: m.pricing?.input !== undefined && m.pricing.input < 1 ? 'var(--accent-emerald)' : undefined, whiteSpace: 'nowrap' }}>
                    {fmtPrice(m.pricing?.input)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>{fmtPrice(m.pricing?.output)}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {m.reasoning && <span style={badgeStyle('#a78bfa', 'rgba(167,139,250,0.12)')}><Brain size={10} />{t('models.badgeReasoning')}</span>}
                      {m.toolCall && <span style={badgeStyle('var(--accent)', 'rgba(6,182,212,0.12)')}><Wrench size={10} />{t('models.badgeToolCall')}</span>}
                      {!m.reasoning && !m.toolCall && <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                    {t('models.empty')}
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                    {t('common.loading')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Footer: count + load more ---- */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 11, color: 'var(--text-dim)' }}>
          <span>{t('models.count', { shown: Math.min(visible, filtered.length), total: filtered.length })}</span>
          {visible < filtered.length && (
            <button className="btn btn-sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              {t('models.loadMore')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
