// Renders the components for review. URL parameters pick what to show:
//   ?theme=light|dark  &view=components|settings|confirm|toast
import { Construction, Search, Upload } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import './showcase.css';
import {
  AppBar,
  BackupsCard,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  InstanceInfoCard,
  Select,
  SettingsPanel,
  TextField,
  Textarea,
  ToastProvider,
  applyThemeChoice,
  useToast,
} from '../src/index.ts';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
// Apply it as a saved pick, the way the theme toggle does, so the toggle shows the right icon.
if (theme === 'light' || theme === 'dark') {
  applyThemeChoice(theme, document.documentElement, window.localStorage);
}
const view = params.get('view') ?? 'components';

const settle = () => Promise.resolve();

function Toasts() {
  const toast = useToast();
  useEffect(() => {
    toast('Backup created: crane-backup-20261116-1200.zip', 'success');
    toast('3 cranes imported', 'info');
    toast('Restore failed: the file is not a Crane Charts backup', 'error');
  }, [toast]);
  return null;
}

function Demo() {
  const [settingsOpen, setSettingsOpen] = useState(view === 'settings');
  const [confirmOpen, setConfirmOpen] = useState(view === 'confirm');
  return (
    <>
      <AppBar
        appName="Crane Charts"
        version="1.9.0"
        icon={<Construction size={22} aria-hidden />}
        onMenu={() => undefined}
        search={
          <div className="showcase-search">
            <Search size={16} aria-hidden />
            <input className="hhh-input" placeholder="Search cranes  /" aria-label="Search" />
          </div>
        }
        actions={
          <Button variant="primary" icon={<Upload size={16} aria-hidden />}>
            Upload
          </Button>
        }
        onShortcuts={() => undefined}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="showcase">
        <section>
          <h2>Buttons</h2>
          <div className="showcase-row">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Delete crane</Button>
            <Button variant="primary" busy>
              Saving
            </Button>
            <Button disabled>Disabled</Button>
            <Button size="sm">Small</Button>
          </div>
        </section>
        <section>
          <h2>Fields</h2>
          <div className="showcase-grid">
            <TextField label="Make" defaultValue="Liebherr" hint="As printed on the chart" />
            <TextField
              label="Capacity"
              defaultValue=""
              placeholder="e.g. 250t"
              error="Capacity is required"
            />
            <Select label="Type" defaultValue="mobile">
              <option value="mobile">Mobile</option>
              <option value="crawler">Crawler</option>
            </Select>
            <Textarea label="Notes" placeholder="Anything worth knowing about this chart" />
            <Checkbox
              label="Include uploads in backups"
              hint="Turn off when PDFs are on a NAS"
              defaultChecked
            />
          </div>
        </section>
        <section>
          <h2>Badges and text</h2>
          <div className="showcase-row">
            <Badge>Neutral</Badge>
            <Badge tone="accent">3 files</Badge>
            <Badge tone="success">Healthy</Badge>
            <Badge tone="warning">Overdue</Badge>
            <Badge tone="danger">Failed</Badge>
            <Badge tone="info">Info</Badge>
          </div>
          <p className="showcase-text">
            Primary text, <span className="showcase-secondary">secondary text</span> and{' '}
            <span className="showcase-tertiary">tertiary hints</span>, with an{' '}
            <a href="#x">inline link</a>.
          </p>
          <div className="showcase-row">
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Open a confirm dialog
            </Button>
          </div>
        </section>
      </main>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <InstanceInfoCard
          info={{
            version: '1.9.0',
            counts: [{ label: 'Catalogue', value: '78 cranes · 91 files' }],
            paths: {
              database: '/config/crane.db',
              uploads: '/config/uploads',
              backups: '/config/backups',
            },
            limits: [
              { label: 'Max upload', value: '500 MB' },
              { label: 'Rate limits', value: '60 uploads, 60 writes per minute' },
            ],
            trustProxyHops: 1,
          }}
        />
        <BackupsCard
          status={{ tone: 'success', label: 'Healthy' }}
          schedule="Every 24 h, keeping 7 · last 16 Nov 2026, 03:00"
          backups={[
            {
              name: 'crane-backup-20261116-0300.zip',
              size: '12.4 MB',
              created: '16 Nov 2026, 03:00',
            },
            {
              name: 'crane-backup-20261115-0300.zip',
              size: '12.3 MB',
              created: '15 Nov 2026, 03:00',
            },
            {
              name: 'crane-backup-20261114-0300-prerestore.zip',
              size: '12.1 MB',
              created: '14 Nov 2026, 09:12',
            },
          ]}
          freshDownloadHref="#download"
          downloadHref={(name) => `#download/${name}`}
          onBackupNow={settle}
          onRestore={settle}
          onUploadRestore={settle}
        />
      </SettingsPanel>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this crane?"
        message="This deletes Liebherr LTM 1250-5.1 and its 3 files. It can only be undone by restoring a backup."
        confirmLabel="Delete crane"
        danger
        error="The uploads folder is read-only, so nothing was deleted."
        onConfirm={() => undefined}
        onCancel={() => setConfirmOpen(false)}
      />
      {view === 'toast' ? <Toasts /> : null}
    </>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ToastProvider duration={60_000}>
        <Demo />
      </ToastProvider>
    </StrictMode>
  );
}
