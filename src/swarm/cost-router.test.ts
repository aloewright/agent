import { describe, it, expect, vi } from 'vitest';
import { CostAwareRouter } from './cost-router';

function mockSandbox(cliAvailable: boolean, cliOutput = 'CLI response') {
  return {
    exec: vi.fn(async (cmd: string) => {
      if (cmd.startsWith('which')) {
        return { stdout: cliAvailable ? '/usr/bin/claude\nOK' : '', stderr: '' };
      }
      if (!cliAvailable) throw new Error('CLI not found');
      return { stdout: cliOutput, stderr: '' };
    }),
  };
}

function mockGatewayFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'Gateway response' } }] })),
  );
}

describe('CostAwareRouter', () => {
  it('uses CLI when available (free path)', async () => {
    const sandbox = mockSandbox(true, 'CLI built the API');
    const gateway = mockGatewayFetch();
    const router = new CostAwareRouter(sandbox);
    const result = await router.route({
      prompt: 'Build an API',
      model: { primary: 'claude-cli', fallbacks: ['cf-ai-gw-anthropic/claude-sonnet-4-5'] },
      cli: { tool: 'claude', args: ['--dangerously-skip-permissions'] },
    }, gateway);
    expect(result.content).toBe('CLI built the API');
    expect(result.source).toBe('cli');
    expect(result.costSaved).toBeGreaterThan(0);
    expect(gateway).not.toHaveBeenCalled();
  });

  it('falls back to AI Gateway when CLI unavailable', async () => {
    const sandbox = mockSandbox(false);
    const gateway = mockGatewayFetch();
    const router = new CostAwareRouter(sandbox);
    const result = await router.route({
      prompt: 'Build an API',
      model: { primary: 'claude-cli', fallbacks: ['cf-ai-gw-anthropic/claude-sonnet-4-5'] },
      cli: { tool: 'claude' },
    }, gateway);
    expect(result.content).toBe('Gateway response');
    expect(result.source).toBe('gateway');
    expect(result.costSaved).toBe(0);
    expect(gateway).toHaveBeenCalled();
  });

  it('falls back to AI Gateway when CLI errors', async () => {
    const sandbox = {
      exec: vi.fn(async (cmd: string) => {
        if (cmd.startsWith('which')) return { stdout: '/usr/bin/claude\nOK', stderr: '' };
        return { stdout: '', stderr: 'Error: rate limited' };
      }),
    };
    const gateway = mockGatewayFetch();
    const router = new CostAwareRouter(sandbox);
    const result = await router.route({
      prompt: 'Build an API',
      model: { primary: 'claude-cli', fallbacks: ['cf-ai-gw-anthropic/claude-sonnet-4-5'] },
      cli: { tool: 'claude' },
    }, gateway);
    expect(result.content).toBe('Gateway response');
    expect(result.source).toBe('gateway');
  });

  it('tracks cumulative cost savings', async () => {
    const sandbox = mockSandbox(true, 'Response');
    const router = new CostAwareRouter(sandbox);
    await router.route({ prompt: 'Task 1', model: { primary: 'claude-cli' }, cli: { tool: 'claude' } });
    await router.route({ prompt: 'Task 2', model: { primary: 'claude-cli' }, cli: { tool: 'claude' } });
    expect(router.totalCostSaved()).toBeGreaterThan(0);
  });
});
