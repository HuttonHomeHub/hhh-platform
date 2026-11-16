// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppBar,
  BackupsCard,
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  ConfirmDialog,
  Dialog,
  IconButton,
  InstanceInfoCard,
  Select,
  SettingsPanel,
  TextField,
  Textarea,
  THEME_STORAGE_KEY,
  TOAST_DURATION_MS,
  ToastProvider,
  useToast,
} from '../src/index.ts';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('buttons', () => {
  it('runs onClick, and shows a spinner and disables while busy', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
    rerender(
      <Button busy onClick={onClick}>
        Save
      </Button>
    );
    const button = screen.getByRole('button', { name: /Save/ });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('icon buttons carry their label for screen readers and as the tooltip', () => {
    render(<IconButton label="Settings" icon={<svg />} />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button.getAttribute('title')).toBe('Settings');
  });

  it('button links are links with button styling', () => {
    render(
      <ButtonLink href="/x" variant="primary">
        Download
      </ButtonLink>
    );
    expect(screen.getByRole('link', { name: 'Download' }).className).toContain(
      'hhh-button--primary'
    );
  });

  it('badges carry their tone', () => {
    render(<Badge tone="success">OK</Badge>);
    expect(screen.getByText('OK').className).toBe('hhh-badge hhh-badge--success');
  });
});

describe('fields', () => {
  it('labels, hints and errors are wired for assistive tech', () => {
    render(<TextField label="Make" hint="As on the chart" error="Required" defaultValue="" />);
    const input = screen.getByLabelText('Make');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'As on the chart',
      'Required',
    ]);
    expect(screen.getByRole('alert').textContent).toBe('Required');
  });

  it('valid fields are not marked invalid; other field types follow the same layout', () => {
    render(
      <>
        <TextField label="Model" />
        <Textarea label="Notes" hint="Optional" />
        <Select label="Type" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
        <Checkbox label="Include uploads" hint="Larger backups" defaultChecked />
      </>
    );
    expect(screen.getByLabelText('Model').getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('b');
    expect((screen.getByLabelText('Include uploads') as HTMLInputElement).checked).toBe(true);
  });
});

describe('dialogs', () => {
  it('shows its content when open and closes through Esc and the close button', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open={false} title="Edit crane" onClose={onClose}>
        Body
      </Dialog>
    );
    expect(screen.queryByText('Body')).toBeNull();
    rerender(
      <Dialog open title="Edit crane" onClose={onClose} footer={<button>Save</button>}>
        Body
      </Dialog>
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit crane' });
    expect(within(dialog).getByText('Body')).toBeTruthy();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the opener when it closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(
      <Dialog open title="T" onClose={() => undefined}>
        x
      </Dialog>
    );
    screen.getByRole('button', { name: 'Close' }).focus();
    rerender(
      <Dialog open={false} title="T" onClose={() => undefined}>
        x
      </Dialog>
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('confirm dialogs show an action error inside the dialog', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete crane?"
        message="This deletes 3 files."
        confirmLabel="Delete"
        danger
        error="Disk is read-only"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete crane?' });
    expect(within(dialog).getByRole('alert').textContent).toBe('Disk is read-only');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain(
      'hhh-button--danger'
    );
  });
});

describe('toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function Trigger({ kind }: { kind: 'info' | 'error' }) {
    const toast = useToast();
    return <button onClick={() => toast(`${kind} message`, kind)}>show {kind}</button>;
  }

  it('info toasts dismiss themselves; error toasts stay until dismissed', async () => {
    render(
      <ToastProvider>
        <Trigger kind="info" />
        <Trigger kind="error" />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('show info'));
    fireEvent.click(screen.getByText('show error'));
    expect(screen.getByRole('status').textContent).toContain('info message');
    expect(screen.getByRole('alert').textContent).toContain('error message');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10);
    });
    expect(screen.queryByText('info message')).toBeNull();
    expect(screen.getByText('error message')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('error message')).toBeNull();
  });

  it('useToast outside the provider is a clear error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger kind="info" />)).toThrow('inside <ToastProvider>');
    spy.mockRestore();
  });
});

describe('app bar', () => {
  it('shows the app name and running version, and the standard actions in order', async () => {
    const onSettings = vi.fn();
    const onShortcuts = vi.fn();
    const onMenu = vi.fn();
    render(
      <AppBar
        appName="Crane Charts"
        version="1.9.0"
        onMenu={onMenu}
        onSettings={onSettings}
        onShortcuts={onShortcuts}
        actions={<button>Upload</button>}
      />
    );
    expect(screen.getByText('Crane Charts')).toBeTruthy();
    expect(screen.getByTitle('Running version').textContent).toBe('1.9.0');
    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual([
      'Toggle navigation',
      'Upload',
      'Keyboard shortcuts',
      'Switch to dark theme',
      'Settings',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
    expect([onSettings, onShortcuts, onMenu].every((f) => f.mock.calls.length === 1)).toBe(true);
  });

  it('the theme toggle flips the page and remembers the pick', async () => {
    render(<AppBar appName="X" version="dev" />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('the theme toggle starts from the system setting when nothing is picked', () => {
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('matchMedia', matchMedia);
    render(<AppBar appName="X" version="dev" />);
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe('settings panel', () => {
  const info = {
    version: '1.9.0',
    counts: [{ label: 'Catalogue', value: '78 cranes · 91 files' }],
    paths: { database: '/config/crane.db', uploads: '/config/uploads', backups: '/config/backups' },
    limits: [{ label: 'Max upload', value: '500 MB' }],
    trustProxyHops: 1,
  };

  function backups(overrides: Partial<Parameters<typeof BackupsCard>[0]> = {}) {
    return {
      status: { tone: 'success' as const, label: 'Healthy' },
      schedule: 'Every 24 h, keeping 7',
      backups: [
        { name: 'crane-backup-20261116-0300.zip', size: '12.4 MB', created: '16 Nov 2026, 03:00' },
      ],
      freshDownloadHref: '/api/backup/download',
      downloadHref: (name: string) => `/api/backup/download/${name}`,
      onBackupNow: vi.fn().mockResolvedValue(undefined),
      onRestore: vi.fn().mockResolvedValue(undefined),
      onUploadRestore: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('the instance card lists version, counts, paths, limits and proxy', () => {
    render(
      <SettingsPanel open onClose={() => undefined}>
        <InstanceInfoCard info={info} />
      </SettingsPanel>
    );
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    for (const text of [
      '1.9.0',
      '78 cranes · 91 files',
      '/config/crane.db',
      '500 MB',
      'yes (1 hop)',
    ]) {
      expect(within(panel).getByText(text)).toBeTruthy();
    }
  });

  it('says "no" when no proxy is trusted, and pluralises hops', () => {
    const { rerender } = render(<InstanceInfoCard info={{ ...info, trustProxyHops: 0 }} />);
    expect(screen.getByText('no')).toBeTruthy();
    rerender(<InstanceInfoCard info={{ ...info, trustProxyHops: 2 }} />);
    expect(screen.getByText('yes (2 hops)')).toBeTruthy();
  });

  it('backs up now, and shows an error in the card if it fails', async () => {
    const props = backups({ onBackupNow: vi.fn().mockRejectedValue(new Error('Disk full')) });
    render(<BackupsCard {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(props.onBackupNow).toHaveBeenCalledOnce();
    expect((await screen.findByRole('alert')).textContent).toBe('Disk full');
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      '/api/backup/download/crane-backup-20261116-0300.zip'
    );
  });

  it('restores a listed backup only after confirming', async () => {
    const props = backups();
    render(<BackupsCard {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    expect(within(dialog).getByText('crane-backup-20261116-0300.zip')).toBeTruthy();
    expect(props.onRestore).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(props.onRestore).toHaveBeenCalledWith('crane-backup-20261116-0300.zip');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the confirm dialog open with the error when a restore fails', async () => {
    const props = backups({ onRestore: vi.fn().mockRejectedValue(new Error('Not a backup')) });
    render(<BackupsCard {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Not a backup');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('restores an uploaded file after confirming; the button waits for a file', async () => {
    const props = backups({ backups: [] });
    render(<BackupsCard {...props} />);
    expect(screen.getByText(/No backups yet/)).toBeTruthy();
    const upload = screen.getByRole('button', { name: 'Upload & restore' });
    expect(upload).toHaveProperty('disabled', true);
    const file = new File(['zip'], 'old.zip', { type: 'application/zip' });
    await userEvent.upload(screen.getByLabelText('Backup file to restore'), file);
    await userEvent.click(upload);
    const dialog = screen.getByRole('dialog', { name: 'Restore this backup?' });
    expect(within(dialog).getByText('old.zip')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(props.onUploadRestore).toHaveBeenCalledWith(file);
  });
});
