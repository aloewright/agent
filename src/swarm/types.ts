/** CLI tool configuration — the primary execution method */
export interface CliConfig {
  tool: 'claude' | 'codex' | 'gemini';
  args?: string[];
  timeout?: number;
  env?: Record<string, string>;
}

export interface ModelConfig {
  primary: string;
  fallbacks?: string[];
}

export interface AgentIdentity {
  name: string;
  emoji?: string;
}

export interface AgentSandbox {
  mode: 'sandbox' | 'none';
  scope: 'agent' | 'shared';
}

export interface AgentTools {
  allow?: string[];
  deny?: string[];
}

export interface AgentSubagents {
  allowAgents: string[];
}

export interface SwarmAgentDefinition {
  name: string;
  identity: AgentIdentity;
  model: ModelConfig;
  cli?: CliConfig;
  tools?: AgentTools;
  sandbox?: AgentSandbox;
  subagents?: AgentSubagents;
  workspace?: string;
  systemPrompt?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface MemoryEntry {
  key: string;
  value: string;
  agentId: string;
  timestamp: number;
  embedding?: number[];
  ttl?: number;
}

export interface SwarmStatus {
  agents: Array<{ name: string; model: string; cli?: string; status: string }>;
  memory: { kvEntries: number; embeddingsDim: number };
  costSaved: number;
}
