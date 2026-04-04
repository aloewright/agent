import { describe, it, expect } from 'vitest';
import { SwarmAgent } from './agent.entity';

describe('SwarmAgent', () => {
  it('creates with idle status', () => {
    const agent = SwarmAgent.create('coordinator', 'claude');
    expect(agent.status.isIdle()).toBe(true);
    expect(agent.definitionId).toBe('coordinator');
    expect(agent.primaryCli).toBe('claude');
  });

  it('transitions to working when assigned a task', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Build API');
    expect(agent.status.isWorking()).toBe(true);
    expect(agent.currentTask).toBe('Build API');
  });

  it('emits AgentTaskAssigned event', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Build API');
    const events = agent.getUncommittedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.task.assigned');
  });

  it('completes task and returns to idle', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Build API');
    agent.completeTask('Done');
    expect(agent.status.isIdle()).toBe(true);
    expect(agent.currentTask).toBeUndefined();
  });

  it('tracks cost savings', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.recordCliExecution(0.003);
    agent.recordCliExecution(0.005);
    expect(agent.totalCostSaved).toBeCloseTo(0.008);
  });

  it('cannot assign task to failed agent', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.fail('Out of memory');
    expect(() => agent.assignTask('New task')).toThrow('Cannot assign task to failed agent');
  });

  it('clears events after commit', () => {
    const agent = SwarmAgent.create('coder', 'codex');
    agent.assignTask('Task');
    expect(agent.getUncommittedEvents()).toHaveLength(1);
    agent.clearEvents();
    expect(agent.getUncommittedEvents()).toHaveLength(0);
  });
});
