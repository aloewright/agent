import { describe, it, expect, vi } from 'vitest';
import { TerminalSession, buildTerminalCommand } from './terminal';

describe('buildTerminalCommand', () => {
  it('builds claude command for interactive use', () => {
    const cmd = buildTerminalCommand('claude', { workspace: '/root/clawd' });
    expect(cmd).toContain('claude');
    expect(cmd).toContain('cd /root/clawd');
  });

  it('builds codex command', () => {
    const cmd = buildTerminalCommand('codex', {});
    expect(cmd).toContain('codex');
  });

  it('builds a shell command for general use', () => {
    const cmd = buildTerminalCommand('shell', {});
    expect(cmd).toBe('bash');
  });
});

describe('TerminalSession', () => {
  it('starts a process and captures output', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: 'Hello from claude\n', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('claude', {});

    expect(mockSandbox.startProcess).toHaveBeenCalled();
    expect(session.isRunning()).toBe(true);

    const output = await session.readOutput();
    expect(output).toContain('Hello from claude');
  });

  it('stops the process on close', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('shell', {});
    await session.close();

    expect(mockProcess.kill).toHaveBeenCalled();
    expect(session.isRunning()).toBe(false);
  });

  it('writes input to process via exec', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('shell', {});
    await session.writeInput('ls -la\n');

    expect(mockSandbox.exec).toHaveBeenCalled();
  });

  it('returns only new output on subsequent reads', async () => {
    const mockProcess = {
      id: 'proc-1',
      status: 'running',
      getLogs: vi.fn()
        .mockResolvedValueOnce({ stdout: 'line 1\n', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'line 1\nline 2\n', stderr: '' }),
      kill: vi.fn(),
    };
    const mockSandbox = {
      startProcess: vi.fn().mockResolvedValue(mockProcess),
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    };

    const session = new TerminalSession(mockSandbox as any);
    await session.start('shell', {});

    const first = await session.readOutput();
    expect(first).toBe('line 1\n');

    const second = await session.readOutput();
    expect(second).toBe('line 2\n');
  });
});
