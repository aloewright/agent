import { useState } from 'react';
import AdminPage from './pages/AdminPage';
import TerminalPage from './pages/TerminalPage';
import SettingsPage from './pages/SettingsPage';
import './App.css';

export default function App() {
  const [view, setView] = useState<'admin' | 'terminal' | 'settings'>('admin');

  return (
    <div className="app">
      <header className="app-header">
        <img src="/logo-small.png" alt="OpenClaw" className="header-logo" />
        <h1>OpenClaw Admin</h1>
        <nav className="header-nav">
          <button
            className={view === 'admin' ? 'active' : ''}
            onClick={() => setView('admin')}
          >Devices</button>
          <button
            className={view === 'terminal' ? 'active' : ''}
            onClick={() => setView('terminal')}
          >Terminal</button>
          <button
            className={view === 'settings' ? 'active' : ''}
            onClick={() => setView('settings')}
          >Settings</button>
        </nav>
      </header>
      <main className="app-main">
        {view === 'admin' && <AdminPage />}
        {view === 'terminal' && <TerminalPage onBack={() => setView('admin')} />}
        {view === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
