export interface SwarmDomainEvent {
  type: string;
  agentId: string;
  timestamp: number;
  payload: unknown;
}

export function agentTaskAssigned(agentId: string, task: string): SwarmDomainEvent {
  return { type: 'agent.task.assigned', agentId, timestamp: Date.now(), payload: { task } };
}

export function agentTaskCompleted(agentId: string, result: string): SwarmDomainEvent {
  return { type: 'agent.task.completed', agentId, timestamp: Date.now(), payload: { result } };
}

export function agentFailed(agentId: string, reason: string): SwarmDomainEvent {
  return { type: 'agent.failed', agentId, timestamp: Date.now(), payload: { reason } };
}
