import { describe, it, expect, vi } from 'vitest';
import { findExistingOpenClawProcess, ensureOpenClawGateway } from './process';
import type { Sandbox, Process } from '@cloudflare/sandbox';
import { createMockSandbox, createMockEnv } from '../test-utils';
import { STARTUP_TIMEOUT_MS } from '../config';

function createFullMockProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: 'test-id',
    command: 'openclaw gateway',
    status: 'running',
    startTime: new Date(),
    endTime: undefined,
    exitCode: undefined,
    waitForPort: vi.fn(),
    kill: vi.fn(),
    getLogs: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    ...overrides,
  } as Process;
}

describe('findExistingOpenClawProcess', () => {
  it('returns null when no processes exist', async () => {
    const { sandbox } = createMockSandbox({ processes: [] });
    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns null when only CLI commands are running', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw devices list --json', status: 'running' }),
      createFullMockProcess({ command: 'openclaw --version', status: 'completed' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns gateway process when running (openclaw)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: 'openclaw gateway --port 18789',
      status: 'running',
    });
    const processes = [
      createFullMockProcess({ command: 'openclaw devices list', status: 'completed' }),
      gatewayProcess,
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('returns gateway process when starting via startup script', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('matches legacy clawdbot gateway command (transition compat)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: 'clawdbot gateway --port 18789',
      status: 'running',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('matches legacy start-openclaw.sh command (transition compat)', async () => {
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-1',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'running',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBe(gatewayProcess);
  });

  it('ignores completed gateway processes', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw gateway', status: 'completed' }),
      createFullMockProcess({ command: 'start-openclaw.sh', status: 'failed' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBeNull();
  });

  it('handles listProcesses errors gracefully', async () => {
    const sandbox = {
      listProcesses: vi.fn().mockRejectedValue(new Error('Network error')),
    } as unknown as Sandbox;

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBeNull();
  });

  it('returns first matching gateway process', async () => {
    const firstGateway = createFullMockProcess({
      id: 'gateway-1',
      command: 'openclaw gateway',
      status: 'running',
    });
    const secondGateway = createFullMockProcess({
      id: 'gateway-2',
      command: 'start-openclaw.sh',
      status: 'starting',
    });
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([firstGateway, secondGateway]);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result?.id).toBe('gateway-1');
  });

  it('does not match openclaw onboard as a gateway process', async () => {
    const processes = [
      createFullMockProcess({ command: 'openclaw onboard --non-interactive', status: 'running' }),
    ];
    const { sandbox, listProcessesMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue(processes);

    const result = await findExistingOpenClawProcess(sandbox);
    expect(result).toBeNull();
  });
});

describe('ensureOpenClawGateway', () => {
  it('waits with full startup timeout for an existing starting process without restarting', async () => {
    const waitForPort = vi.fn().mockResolvedValue(undefined);
    const kill = vi.fn();
    const gatewayProcess = createFullMockProcess({
      id: 'gateway-starting',
      command: '/usr/local/bin/start-openclaw.sh',
      status: 'starting',
      waitForPort,
      kill,
    });

    const { sandbox, listProcessesMock, startProcessMock } = createMockSandbox();
    listProcessesMock.mockResolvedValue([gatewayProcess]);
    const env = createMockEnv();

    const result = await ensureOpenClawGateway(sandbox, env);

    expect(result).toBe(gatewayProcess);
    expect(waitForPort).toHaveBeenCalledWith(18789, {
      mode: 'tcp',
      timeout: STARTUP_TIMEOUT_MS,
    });
    expect(kill).not.toHaveBeenCalled();
    expect(startProcessMock).not.toHaveBeenCalled();
  });
});
