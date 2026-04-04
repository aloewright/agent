import { describe, it, expect } from 'vitest';
import { buildAgentsConfig, validateSwarmAgent } from './config';

const validAgent = {
  name: 'coordinator',
  identity: { name: 'Queen', emoji: 'crown' },
  model: { primary: 'claude-cli', fallbacks: ['codex-cli', 'cf-ai-gw-anthropic/claude-sonnet-4-5'] },
  cli: { tool: 'claude' as const, args: ['--dangerously-skip-permissions'] },
  tools: { allow: ['task-orchestration'] },
  sandbox: { mode: 'sandbox' as const, scope: 'shared' as const },
  subagents: { allowAgents: ['coder', 'researcher'] },
};

describe('validateSwarmAgent', () => {
  it('accepts a valid agent with CLI config', () => {
    const result = validateSwarmAgent(validAgent);
    expect(result.valid).toBe(true);
  });

  it('rejects agent missing name', () => {
    const result = validateSwarmAgent({ model: { primary: 'claude-cli' } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: name');
  });

  it('rejects agent missing model', () => {
    const result = validateSwarmAgent({ name: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: model');
  });
});

describe('buildAgentsConfig', () => {
  it('builds config with CLI-first routing', () => {
    const config = buildAgentsConfig([validAgent]);
    expect(config).toHaveLength(1);
    expect(config[0].cli?.tool).toBe('claude');
  });

  it('sets default sandbox scope to agent', () => {
    const agent = { ...validAgent, sandbox: undefined };
    const config = buildAgentsConfig([agent]);
    expect(config[0].sandbox!.scope).toBe('agent');
  });
});
