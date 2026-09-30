import React, { useState, useEffect } from 'react';
import { FileCode2, Save, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../i18n/I18nContext';

export const YamlPage: React.FC = () => {
  const { t } = useI18n();
  const [yamlContent, setYamlContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadYaml = async () => {
    setLoading(true);
    try {
      const res = await api.getRawYaml();
      setYamlContent(res.yaml || '');
      setNotice(null);
    } catch (err: any) {
      setNotice({ type: 'error', text: 'Error: ' + err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadYaml();
  }, []);

  const handleSave = async () => {
    try {
      await api.saveRawYaml(yamlContent);
      setNotice({ type: 'success', text: t('yaml.savedNotice') });
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setNotice({ type: 'error', text: 'Failed: ' + err.message });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <FileCode2 size={18} color="var(--accent)" />
            <span>{t('yaml.title')}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-sm" onClick={loadYaml} disabled={loading}>
              <RefreshCw size={12} />
              <span>{t('yaml.reload')}</span>
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>
              <Save size={12} />
              <span>{t('yaml.save')}</span>
            </button>
          </div>
        </div>

        {notice && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: notice.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
              border: `1px solid ${notice.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
              color: notice.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}
          >
            {notice.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
            <span>{notice.text}</span>
          </div>
        )}

        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>
          {t('yaml.desc')}
        </p>

        <textarea
          value={yamlContent}
          onChange={e => setYamlContent(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            height: '560px',
            background: 'var(--input-bg)',
            border: '1px solid var(--card-border)',
            borderRadius: '10px',
            color: 'var(--text-main)',
            fontFamily: 'JetBrains Mono, Consolas, Monaco, monospace',
            fontSize: '13px',
            lineHeight: '1.6',
            padding: '18px',
            outline: 'none',
            resize: 'vertical',
            whiteSpace: 'pre',
          }}
        />
      </div>
    </div>
  );
};
