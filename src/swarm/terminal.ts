import type { Sandbox, Process } from '@cloudflare/sandbox';

interface TerminalOptions {
  workspace?: string;
  env?: Record<string, string>;
}

export function buildTerminalCommand(tool: string, options: TerminalOptions): string {
  const cdPrefix = options.workspace ? `cd ${options.workspace} && ` : '';
  switch (tool) {
    case 'claude':
      return `${cdPrefix}claude --dangerously-skip-permissions`;
    case 'codex':
      return `${cdPrefix}codex`;
    case 'gemini':
      return `${cdPrefix}gemini`;
    case 'shell':
      return 'bash';
    default:
      return `${cdPrefix}${tool}`;
  }
}

export class TerminalSession {
  private sandbox: Sandbox;
  private process: Process | null = null;
  private lastLogOffset = 0;
  private running = false;

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox;
  }

  async start(tool: string, options: TerminalOptions): Promise<void> {
    const command = buildTerminalCommand(tool, options);
    this.process = await this.sandbox.startProcess(command, {
      env: options.env,
    });
    this.running = true;
    this.lastLogOffset = 0;
  }

  async readOutput(): Promise<string> {
    if (!this.process) return '';
    const logs = await this.process.getLogs();
    const stdout = logs.stdout ?? '';
    const stderr = logs.stderr ?? '';
    const combined = stdout + (stderr ? `\x1b[31m${stderr}\x1b[0m` : '');
    const newOutput = combined.substring(this.lastLogOffset);
    this.lastLogOffset = combined.length;
    return newOutput;
  }

  async writeInput(input: string): Promise<void> {
    if (!this.process) return;
    const escaped = input.replace(/'/g, "'\\''");
    await this.sandbox.exec(
      `echo '${escaped}' >> /tmp/.terminal-input-${this.process.id} 2>/dev/null || true`
    );
  }

  isRunning(): boolean {
    return this.running;
  }

  async close(): Promise<void> {
    if (this.process) {
      try {
        await this.process.kill();
      } catch {
        // process may already be dead
      }
    }
    this.running = false;
    this.process = null;
  }

  getProcessId(): string | null {
    return this.process?.id ?? null;
  }
}
