import { useState, useEffect, useCallback } from 'react';
import {
  getStorageStatus,
  triggerSync,
  restartGateway,
  AuthError,
  type StorageStatusResponse,
} from '../api';
import './SettingsPage.css';

interface EnvStatus {
  has_anthropic_key: boolean;
  has_openai_key: boolean;
  has_cf_ai_gateway_api_key: boolean;
  cf_ai_gateway_model: string | null;
  has_gateway_token: boolean;
  has_r2_access_key: boolean;
  has_r2_secret_key: boolean;
  has_cf_account_id: boolean;
  debug_routes: string;
}

function Toggle({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange?: () => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? 'toggle-on' : ''} ${disabled ? 'toggle-disabled' : ''}`}
      onClick={onChange}
      disabled={disabled || !onChange}
      type="button"
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function formatSyncTime(isoString: string | null) {
  if (!isoString) return 'Never';
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

export default function SettingsPage() {
  const [storage, setStorage] = useState<StorageStatusResponse | null>(null);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [restartInProgress, setRestartInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [storageRes, envRes] = await Promise.all([
        getStorageStatus(),
        fetch('/debug/env', { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null) as Promise<EnvStatus | null>,
      ]);
      setStorage(storageRes);
      setEnv(envRes);
    } catch (err) {
      if (err instanceof AuthError) {
        setError('Authentication required.');
      }
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSync = async () => {
    setSyncInProgress(true);
    try {
      const result = await triggerSync();
      if (result.success) {
        setStorage((prev) => (prev ? { ...prev, lastSync: result.lastSync || null } : null));
      } else {
        setError(result.error || 'Sync failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncInProgress(false);
    }
  };

  const handleRestart = async () => {
    setRestartInProgress(true);
    try {
      const result = await restartGateway();
      if (!result.success) {
        setError(result.error || 'Restart failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed');
    } finally {
      setTimeout(() => setRestartInProgress(false), 3000);
    }
  };

  const aiProvider = env
    ? env.has_cf_ai_gateway_api_key
      ? env.cf_ai_gateway_model || 'CF AI Gateway'
      : env.has_anthropic_key
        ? 'Anthropic'
        : env.has_openai_key
          ? 'OpenAI'
          : 'None'
    : '...';

  return (
    <div className="settings-page">
      {error && (
        <div className="settings-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <section className="settings-group">
        <h2>Storage</h2>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Persistent Storage (R2)</span>
            <span className="setting-hint">
              {storage?.configured
                ? `Last backup: ${formatSyncTime(storage.lastSync)}`
                : storage?.missing
                  ? `Missing: ${storage.missing.join(', ')}`
                  : 'Data lost on restart without R2'}
            </span>
          </div>
          <Toggle on={!!storage?.configured} label="Persistent storage" disabled />
        </div>

        {storage?.configured && (
          <div className="setting-row">
            <div className="setting-info">
              <span className="setting-label">Backup Now</span>
              <span className="setting-hint">Manually sync data to R2</span>
            </div>
            <button
              className="setting-action"
              onClick={handleSync}
              disabled={syncInProgress}
            >
              {syncInProgress ? 'Syncing...' : 'Sync'}
            </button>
          </div>
        )}
      </section>

      <section className="settings-group">
        <h2>Gateway</h2>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Restart Gateway</span>
            <span className="setting-hint">Disconnects all clients temporarily</span>
          </div>
          <button
            className="setting-action setting-action-danger"
            onClick={handleRestart}
            disabled={restartInProgress}
          >
            {restartInProgress ? 'Restarting...' : 'Restart'}
          </button>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Gateway Token</span>
            <span className="setting-hint">Protects gateway access</span>
          </div>
          <Toggle on={!!env?.has_gateway_token} label="Gateway token" disabled />
        </div>
      </section>

      <section className="settings-group">
        <h2>AI Provider</h2>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Active Provider</span>
            <span className="setting-hint">{aiProvider}</span>
          </div>
          <Toggle on={aiProvider !== 'None' && aiProvider !== '...'} label="AI provider" disabled />
        </div>
      </section>

      <section className="settings-group">
        <h2>Security</h2>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Debug Routes</span>
            <span className="setting-hint">Exposes /debug/* endpoints</span>
          </div>
          <Toggle on={env?.debug_routes === 'true'} label="Debug routes" disabled />
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Cloudflare Access</span>
            <span className="setting-hint">JWT authentication for admin</span>
          </div>
          <Toggle on={!!env?.has_cf_account_id} label="Cloudflare Access" disabled />
        </div>
      </section>
    </div>
  );
}
