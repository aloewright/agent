type StatusType = 'idle' | 'working' | 'completed' | 'failed';

export class AgentStatus {
  private constructor(private readonly value: StatusType) {}

  static idle(): AgentStatus { return new AgentStatus('idle'); }
  static working(): AgentStatus { return new AgentStatus('working'); }
  static completed(): AgentStatus { return new AgentStatus('completed'); }
  static failed(): AgentStatus { return new AgentStatus('failed'); }

  isIdle(): boolean { return this.value === 'idle'; }
  isWorking(): boolean { return this.value === 'working'; }
  isCompleted(): boolean { return this.value === 'completed'; }
  isFailed(): boolean { return this.value === 'failed'; }

  toString(): string { return this.value; }

  equals(other: AgentStatus): boolean {
    return this.value === other.value;
  }
}
