import { AgentStatus } from './agent-status.vo';
import { SwarmDomainEvent, agentTaskAssigned, agentTaskCompleted, agentFailed } from './swarm-event';

export class SwarmAgent {
  private _status: AgentStatus;
  private _currentTask?: string;
  private _totalCostSaved = 0;
  private _events: SwarmDomainEvent[] = [];

  private constructor(
    public readonly id: string,
    public readonly definitionId: string,
    public readonly primaryCli: string,
  ) {
    this._status = AgentStatus.idle();
  }

  static create(definitionId: string, primaryCli: string): SwarmAgent {
    const id = `${definitionId}-${Date.now()}`;
    return new SwarmAgent(id, definitionId, primaryCli);
  }

  get status(): AgentStatus { return this._status; }
  get currentTask(): string | undefined { return this._currentTask; }
  get totalCostSaved(): number { return this._totalCostSaved; }

  assignTask(task: string): void {
    if (this._status.isFailed()) {
      throw new Error('Cannot assign task to failed agent');
    }
    this._currentTask = task;
    this._status = AgentStatus.working();
    this._events.push(agentTaskAssigned(this.id, task));
  }

  completeTask(result: string): void {
    this._currentTask = undefined;
    this._status = AgentStatus.idle();
    this._events.push(agentTaskCompleted(this.id, result));
  }

  fail(reason: string): void {
    this._currentTask = undefined;
    this._status = AgentStatus.failed();
    this._events.push(agentFailed(this.id, reason));
  }

  recordCliExecution(costSaved: number): void {
    this._totalCostSaved += costSaved;
  }

  getUncommittedEvents(): SwarmDomainEvent[] {
    return [...this._events];
  }

  clearEvents(): void {
    this._events = [];
  }
}
