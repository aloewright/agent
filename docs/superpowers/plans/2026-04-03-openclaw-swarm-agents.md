# OpenClaw Swarm Agents — CLI-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure OpenClaw's `agents.list[]` with ruflo V3-style swarm agents that default to running CLI tools (Claude Code, Codex, Gemini CLI) inside the Cloudflare Sandbox via OAuth — dramatically cheaper than API keys. AI Gateway is the fallback only. Agent state uses hybrid memory (Cloudflare KV for fast lookups + Workers AI embeddings for semantic search).

**Architecture:** Each swarm agent runs inside the sandbox as a CLI process (`claude`, `codex`, `gemini`) authenticated via OAuth tokens stored in Cloudflare KV. The coordinator agent delegates tasks by spawning CLI subprocesses. A hybrid memory layer uses KV for the message bus and agent state, plus Workers AI embeddings for semantic retrieval of past context. AI Gateway is only invoked as a fallback when CLI tools are unavailable or rate-limited. Ruflo V3 patterns (adaptive model routing, hierarchical-mesh topology, cost-aware scheduling) minimize spend.

**Tech Stack:** Cloudflare Workers + Sandbox, Claude Code CLI (OAuth), Codex CLI, Gemini CLI, Cloudflare KV, Workers AI (embeddings), AI Gateway (fallback only), Hono, Vitest.

---

## Cost Model: Why CLI-First

| Approach | Cost | Auth |
|----------|------|------|
| Claude Code CLI (OAuth) | Included with Max/Team plan | OAuth token |
| Codex CLI | Free tier / included | OAuth token |
| Gemini CLI | Free tier available | OAuth token |
| AI Gateway → Anthropic API | ~$3-15/MTok | API key |
| AI Gateway → OpenAI API | ~$1-15/MTok | API key |
| AI Gateway → Workers AI | Pay-per-inference | API key |

**Default path:** CLI tools via OAuth (near-zero marginal cost)
**Fallback path:** AI Gateway API calls (only when CLI unavailable)

---

## File Structure

```
agents-swarm.json                   # NEW: Agent definitions with CLI-first config
src/
├── swarm/                          # NEW: Swarm orchestration
│   ├── index.ts                    # Public exports
│   ├── types.ts                    # Agent, memory, config types
│   ├── config.ts                   # Build agents.list[] from definitions
│   ├── config.test.ts              # Config validation tests
│   ├── cli-runner.ts               # Execute CLI tools in sandbox
│   ├── cli-runner.test.ts          # CLI runner tests
│   ├── memory.ts                   # Hybrid memory (KV + embeddings)
│   ├── memory.test.ts              # Memory layer tests
│   ├── cost-router.ts              # V3 adaptive cost-aware routing
│   └── cost-router.test.ts         # Router tests
├── routes/
│   └── swarm.ts                    # NEW: /api/admin/swarm/* endpoints
```

**Modified files:**
- `Dockerfile` — install Claude Code, Codex, Gemini CLIs
- `start-openclaw.sh` — inject agents.list + OAuth token setup
- `src/index.ts` — mount swarm routes
- `src/types.ts` — add KV + AI bindings
- `wrangler.jsonc` — add KV namespace, Workers AI, increase instances

---

## Task 1: Install CLI Tools in Dockerfile

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add CLI tool installation to Dockerfile**

After the OpenClaw install (line 26), add:

```dockerfile
# Install AI CLI tools for swarm agents (OAuth-based, not API keys)
# Claude Code CLI - Anthropic's coding agent
RUN npm install -g @anthropic-ai/claude-code@latest \
    && claude --version || echo "Claude Code CLI installed"

# Codex CLI - OpenAI's coding agent
RUN npm install -g @openai/codex@latest \
    && codex --version || echo "Codex CLI installed"

# Gemini CLI - Google's coding agent
RUN npm install -g @google/gemini-cli@0.1.36 \
    && gemini --version

# Create OAuth token storage directory
RUN mkdir -p /root/.claude /root/.codex /root/.gemini
```

- [ ] **Step 2: Update cache bust comment**

```dockerfile
# Build cache bust: 2026-04-03-v31-swarm-cli-tools
```

- [ ] **Step 3: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add Dockerfile
git commit -m "feat(swarm): install Claude Code, Codex, Gemini CLIs in sandbox container"
```

---

## Task 2: Swarm Types and Config Builder

**Files:**
- Create: `src/swarm/types.ts`
- Create: `src/swarm/config.ts`
- Create: `src/swarm/index.ts`
- Test: `src/swarm/config.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/swarm/config.test.ts
import { describe, it, expect } from 'vitest';
import { buildAgentsConfig, validateSwarmAgent } from './config';

const validAgent = {
  name: 'coordinator',
  identity: { name: 'Queen', emoji: 'crown' },
  model: { primary: 'claude-cli', fallbacks: ['codex-cli', 'cf-ai-gw-anthropic/claude-sonnet-4-5'] },
  cli: { tool: 'claude', args: ['--dangerously-skip-permissions'] },
  tools: { allow: ['task-orchestration'] },
  sandbox: { mode: 'sandbox', scope: 'shared' },
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
    expect(config[0].sandbox.scope).toBe('agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create swarm types**

```typescript
// src/swarm/types.ts

/** CLI tool configuration — the primary execution method */
export interface CliConfig {
  tool: 'claude' | 'codex' | 'gemini';
  args?: string[];
  timeout?: number;       // ms, default 120000
  env?: Record<string, string>;  // Extra env vars for the CLI
}

/** Model routing: CLI tools first, AI Gateway as fallback */
export interface ModelConfig {
  primary: string;        // e.g. "claude-cli", "codex-cli", "gemini-cli"
  fallbacks?: string[];   // e.g. ["codex-cli", "cf-ai-gw-anthropic/claude-sonnet-4-5"]
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

/** Full agent definition with CLI-first routing */
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

/** Memory entry stored in KV */
export interface MemoryEntry {
  key: string;
  value: string;
  agentId: string;
  timestamp: number;
  embedding?: number[];   // Workers AI embedding for semantic search
  ttl?: number;
}

/** Swarm status */
export interface SwarmStatus {
  agents: Array<{ name: string; model: string; cli?: string; status: string }>;
  memory: { kvEntries: number; embeddingsDim: number };
  costSaved: number;  // Estimated cost saved by using CLI vs API
}
```

- [ ] **Step 4: Implement config builder**

```typescript
// src/swarm/config.ts
import type { SwarmAgentDefinition, ValidationResult } from './types';

export function validateSwarmAgent(input: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  if (!input.name) errors.push('Missing required field: name');
  if (!input.model) errors.push('Missing required field: model');
  return { valid: errors.length === 0, errors };
}

export function buildAgentsConfig(
  agents: SwarmAgentDefinition[],
): SwarmAgentDefinition[] {
  return agents.map((agent) => {
    const result = validateSwarmAgent(agent as unknown as Record<string, unknown>);
    if (!result.valid) {
      throw new Error(`Invalid agent "${agent.name ?? '?'}": ${result.errors.join(', ')}`);
    }
    return {
      ...agent,
      identity: agent.identity ?? { name: agent.name },
      sandbox: agent.sandbox ?? { mode: 'sandbox' as const, scope: 'agent' as const },
      subagents: agent.subagents ?? { allowAgents: [] },
    };
  });
}
```

- [ ] **Step 5: Create module index**

```typescript
// src/swarm/index.ts
export { buildAgentsConfig, validateSwarmAgent } from './config';
export type * from './types';
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/config.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add src/swarm/types.ts src/swarm/config.ts src/swarm/config.test.ts src/swarm/index.ts
git commit -m "feat(swarm): add CLI-first agent types and config builder"
```

---

## Task 3: CLI Runner — Execute AI Tools in Sandbox

**Files:**
- Create: `src/swarm/cli-runner.ts`
- Test: `src/swarm/cli-runner.test.ts`

This is the core innovation: run `claude`, `codex`, or `gemini` as sandbox processes.

- [ ] **Step 1: Write the failing test**

```typescript
// src/swarm/cli-runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildCliCommand, parseCliOutput, estimateCostSavings } from './cli-runner';

describe('buildCliCommand', () => {
  it('builds claude command with prompt', () => {
    const cmd = buildCliCommand('claude', 'Write a function', {
      args: ['--dangerously-skip-permissions'],
    });
    expect(cmd).toBe('claude --dangerously-skip-permissions -p "Write a function"');
  });

  it('builds codex command with prompt', () => {
    const cmd = buildCliCommand('codex', 'Fix the bug', { args: ['--quiet'] });
    expect(cmd).toBe('codex --quiet -p "Fix the bug"');
  });

  it('builds gemini command with prompt', () => {
    const cmd = buildCliCommand('gemini', 'Analyze code', {});
    expect(cmd).toBe('gemini -p "Analyze code"');
  });

  it('escapes quotes in prompt', () => {
    const cmd = buildCliCommand('claude', 'Say "hello"', {});
    expect(cmd).toBe('claude -p "Say \\"hello\\""');
  });
});

describe('parseCliOutput', () => {
  it('extracts content from stdout', () => {
    const result = parseCliOutput('Here is the code:\n```\nconst x = 1;\n```', '');
    expect(result.content).toContain('const x = 1');
    expect(result.success).toBe(true);
  });

  it('marks failure on stderr with error', () => {
    const result = parseCliOutput('', 'Error: authentication failed');
    expect(result.success).toBe(false);
    expect(result.error).toContain('authentication failed');
  });
});

describe('estimateCostSavings', () => {
  it('estimates savings for claude-cli vs API', () => {
    const savings = estimateCostSavings('claude', 1000, 500);
    expect(savings.apiCostEstimate).toBeGreaterThan(0);
    expect(savings.cliCost).toBe(0);
    expect(savings.saved).toBe(savings.apiCostEstimate);
  });

  it('returns zero savings for API fallback', () => {
    const savings = estimateCostSavings('cf-ai-gw-anthropic', 1000, 500);
    expect(savings.saved).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/cli-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CLI runner**

```typescript
// src/swarm/cli-runner.ts
import type { CliConfig } from './types';

interface CliOutput {
  content: string;
  success: boolean;
  error?: string;
  durationMs?: number;
}

interface CostSavings {
  apiCostEstimate: number;  // $ estimated if using API
  cliCost: number;          // $ for CLI (0 for OAuth)
  saved: number;            // $ saved
}

// Estimated API costs per token (rough averages)
const API_COST_PER_INPUT_TOKEN = 3 / 1_000_000;   // ~$3/MTok (Sonnet)
const API_COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;  // ~$15/MTok (Sonnet)

const CLI_TOOLS = new Set(['claude', 'codex', 'gemini']);

export function buildCliCommand(
  tool: string,
  prompt: string,
  config: Partial<CliConfig>,
): string {
  const escapedPrompt = prompt.replace(/"/g, '\\"');
  const args = config.args?.join(' ') ?? '';
  const argsPart = args ? `${args} ` : '';
  return `${tool} ${argsPart}-p "${escapedPrompt}"`;
}

export function parseCliOutput(stdout: string, stderr: string): CliOutput {
  const hasError = stderr && (
    stderr.toLowerCase().includes('error') ||
    stderr.toLowerCase().includes('failed') ||
    stderr.toLowerCase().includes('denied')
  );

  if (hasError && !stdout.trim()) {
    return { content: '', success: false, error: stderr.trim() };
  }

  return { content: stdout.trim(), success: true };
}

export function estimateCostSavings(
  tool: string,
  inputTokens: number,
  outputTokens: number,
): CostSavings {
  const apiCost = (inputTokens * API_COST_PER_INPUT_TOKEN) +
    (outputTokens * API_COST_PER_OUTPUT_TOKEN);

  if (CLI_TOOLS.has(tool)) {
    return { apiCostEstimate: apiCost, cliCost: 0, saved: apiCost };
  }

  return { apiCostEstimate: apiCost, cliCost: apiCost, saved: 0 };
}

/**
 * Execute a CLI tool in the sandbox.
 * Called from the Worker via sandbox.startProcess() / sandbox.exec().
 */
export async function runCliInSandbox(
  sandbox: { exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }> },
  tool: string,
  prompt: string,
  config: Partial<CliConfig> = {},
): Promise<CliOutput> {
  const command = buildCliCommand(tool, prompt, config);
  const timeout = config.timeout ?? 120_000;
  const start = Date.now();

  try {
    const result = await sandbox.exec(command);
    const duration = Date.now() - start;
    const output = parseCliOutput(result.stdout ?? '', result.stderr ?? '');
    output.durationMs = duration;
    return output;
  } catch (error) {
    return {
      content: '',
      success: false,
      error: error instanceof Error ? error.message : 'CLI execution failed',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Determine the best available CLI tool, with fallback chain.
 * Checks if the CLI is installed and authenticated.
 */
export async function resolveCliTool(
  sandbox: { exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }> },
  preferred: string,
  fallbacks: string[] = [],
): Promise<string | null> {
  const candidates = [preferred, ...fallbacks].filter((t) => CLI_TOOLS.has(t));

  for (const tool of candidates) {
    try {
      const check = await sandbox.exec(`which ${tool} 2>/dev/null && echo "OK"`);
      if (check.stdout?.includes('OK')) return tool;
    } catch {
      continue;
    }
  }

  return null; // No CLI available — caller should fall back to AI Gateway
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/cli-runner.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add src/swarm/cli-runner.ts src/swarm/cli-runner.test.ts
git commit -m "feat(swarm): add CLI runner for Claude Code, Codex, Gemini in sandbox"
```

---

## Task 4: Hybrid Memory — KV + Workers AI Embeddings

**Files:**
- Create: `src/swarm/memory.ts`
- Test: `src/swarm/memory.test.ts`
- Modify: `wrangler.jsonc` — add KV namespace + Workers AI binding
- Modify: `src/types.ts` — add KV + AI bindings

- [ ] **Step 1: Write the failing test**

```typescript
// src/swarm/memory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridMemory } from './memory';

function mockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    }),
  };
}

function mockAI() {
  return {
    run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] })),
  };
}

describe('HybridMemory', () => {
  let memory: HybridMemory;
  let kv: ReturnType<typeof mockKV>;
  let ai: ReturnType<typeof mockAI>;

  beforeEach(() => {
    kv = mockKV();
    ai = mockAI();
    memory = new HybridMemory(kv as unknown as KVNamespace, ai);
  });

  it('stores and retrieves by key (KV fast path)', async () => {
    await memory.store('agent-1', 'task-result', 'The API is built');
    const result = await memory.get('agent-1', 'task-result');
    expect(result?.value).toBe('The API is built');
    expect(kv.put).toHaveBeenCalled();
  });

  it('stores with embedding for semantic search', async () => {
    await memory.store('agent-1', 'context', 'Built REST API with auth', true);
    expect(ai.run).toHaveBeenCalled();
    // Embedding stored alongside the value
    const raw = await kv.get('swarm:agent-1:context');
    const parsed = JSON.parse(raw!);
    expect(parsed.embedding).toBeDefined();
  });

  it('lists all entries for an agent', async () => {
    await memory.store('agent-1', 'a', 'value-a');
    await memory.store('agent-1', 'b', 'value-b');
    const entries = await memory.list('agent-1');
    expect(entries).toHaveLength(2);
  });

  it('deletes an entry', async () => {
    await memory.store('agent-1', 'temp', 'data');
    await memory.delete('agent-1', 'temp');
    const result = await memory.get('agent-1', 'temp');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/memory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hybrid memory**

```typescript
// src/swarm/memory.ts
import type { MemoryEntry } from './types';

const PREFIX = 'swarm';
const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

interface AIBinding {
  run: (model: string, input: unknown) => Promise<{ data: number[][] }>;
}

export class HybridMemory {
  private kv: KVNamespace;
  private ai: AIBinding;

  constructor(kv: KVNamespace, ai: AIBinding) {
    this.kv = kv;
    this.ai = ai;
  }

  private key(agentId: string, entryKey: string): string {
    return `${PREFIX}:${agentId}:${entryKey}`;
  }

  async store(
    agentId: string,
    entryKey: string,
    value: string,
    withEmbedding = false,
  ): Promise<void> {
    const entry: MemoryEntry = {
      key: entryKey,
      value,
      agentId,
      timestamp: Date.now(),
    };

    if (withEmbedding) {
      const result = await this.ai.run(EMBEDDING_MODEL, { text: [value] });
      entry.embedding = result.data[0];
    }

    await this.kv.put(this.key(agentId, entryKey), JSON.stringify(entry));
  }

  async get(agentId: string, entryKey: string): Promise<MemoryEntry | null> {
    const raw = await this.kv.get(this.key(agentId, entryKey));
    if (!raw) return null;
    return JSON.parse(raw) as MemoryEntry;
  }

  async list(agentId: string): Promise<MemoryEntry[]> {
    const prefix = `${PREFIX}:${agentId}:`;
    const { keys } = await this.kv.list({ prefix });
    const entries: MemoryEntry[] = [];

    for (const { name } of keys) {
      const raw = await this.kv.get(name);
      if (raw) entries.push(JSON.parse(raw) as MemoryEntry);
    }

    return entries;
  }

  async delete(agentId: string, entryKey: string): Promise<void> {
    await this.kv.delete(this.key(agentId, entryKey));
  }

  /**
   * Semantic search across all agent memories using cosine similarity.
   * Uses Workers AI embeddings for the query, compares against stored embeddings.
   */
  async search(query: string, agentId?: string): Promise<MemoryEntry[]> {
    const queryResult = await this.ai.run(EMBEDDING_MODEL, { text: [query] });
    const queryEmbedding = queryResult.data[0];

    const prefix = agentId ? `${PREFIX}:${agentId}:` : `${PREFIX}:`;
    const { keys } = await this.kv.list({ prefix });

    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const { name } of keys) {
      const raw = await this.kv.get(name);
      if (!raw) continue;
      const entry = JSON.parse(raw) as MemoryEntry;
      if (!entry.embedding) continue;

      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      scored.push({ entry, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => s.entry);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}
```

- [ ] **Step 4: Add KV + AI bindings to wrangler.jsonc**

After the `browser` binding, add:

```jsonc
  // Workers AI binding for embeddings and inference
  "ai": {
    "binding": "AI",
  },
  // KV namespace for swarm agent memory and message bus
  "kv_namespaces": [
    {
      "binding": "SWARM_KV",
      "id": "<create-with-wrangler-kv-namespace-create>"
    }
  ],
```

- [ ] **Step 5: Add bindings to src/types.ts**

In `OpenClawEnv` interface, add:

```typescript
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
  SWARM_KV?: KVNamespace;
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/memory.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add src/swarm/memory.ts src/swarm/memory.test.ts src/types.ts wrangler.jsonc
git commit -m "feat(swarm): add hybrid memory layer with KV + Workers AI embeddings"
```

---

## Task 5: V3 Cost-Aware Router

**Files:**
- Create: `src/swarm/cost-router.ts`
- Test: `src/swarm/cost-router.test.ts`

Ruflo V3 pattern: try CLI first (free), fall back to AI Gateway (paid) only when needed.

- [ ] **Step 1: Write the failing test**

```typescript
// src/swarm/cost-router.test.ts
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
    new Response(JSON.stringify({
      choices: [{ message: { content: 'Gateway response' } }],
    })),
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

    await router.route({
      prompt: 'Task 1',
      model: { primary: 'claude-cli' },
      cli: { tool: 'claude' },
    });
    await router.route({
      prompt: 'Task 2',
      model: { primary: 'claude-cli' },
      cli: { tool: 'claude' },
    });

    expect(router.totalCostSaved()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/cost-router.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement cost-aware router**

```typescript
// src/swarm/cost-router.ts
import type { CliConfig, ModelConfig } from './types';
import { buildCliCommand, parseCliOutput, estimateCostSavings, resolveCliTool } from './cli-runner';

interface RouteRequest {
  prompt: string;
  model: ModelConfig;
  cli?: CliConfig;
  systemPrompt?: string;
}

interface RouteResult {
  content: string;
  source: 'cli' | 'gateway';
  tool?: string;
  costSaved: number;
  durationMs: number;
}

interface SandboxLike {
  exec: (cmd: string) => Promise<{ stdout?: string; stderr?: string }>;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

// Rough token estimation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class CostAwareRouter {
  private sandbox: SandboxLike;
  private savings = 0;

  constructor(sandbox: SandboxLike) {
    this.sandbox = sandbox;
  }

  async route(request: RouteRequest, gatewayFetch?: FetchFn): Promise<RouteResult> {
    const start = Date.now();

    // Step 1: Try CLI (free path)
    if (request.cli) {
      const available = await resolveCliTool(
        this.sandbox,
        request.cli.tool,
        [],
      );

      if (available) {
        const command = buildCliCommand(available, request.prompt, request.cli);
        try {
          const result = await this.sandbox.exec(command);
          const output = parseCliOutput(result.stdout ?? '', result.stderr ?? '');

          if (output.success && output.content) {
            const inputTokens = estimateTokens(request.prompt);
            const outputTokens = estimateTokens(output.content);
            const saved = estimateCostSavings(available, inputTokens, outputTokens);
            this.savings += saved.saved;

            return {
              content: output.content,
              source: 'cli',
              tool: available,
              costSaved: saved.saved,
              durationMs: Date.now() - start,
            };
          }
        } catch {
          // CLI failed — fall through to gateway
        }
      }
    }

    // Step 2: Fall back to AI Gateway (paid path)
    if (gatewayFetch) {
      const fallbackModel = request.model.fallbacks?.find((f) => f.startsWith('cf-ai-gw-'));
      if (fallbackModel) {
        const [, providerAndModel] = fallbackModel.split('cf-ai-gw-');
        const slashIdx = providerAndModel.indexOf('/');
        const provider = providerAndModel.substring(0, slashIdx);
        const modelId = providerAndModel.substring(slashIdx + 1);

        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
        messages.push({ role: 'user', content: request.prompt });

        const response = await gatewayFetch('', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, messages, max_tokens: 8192 }),
        });

        const body = await response.json() as { choices?: Array<{ message: { content: string } }> };
        const content = body.choices?.[0]?.message?.content ?? '';

        return {
          content,
          source: 'gateway',
          costSaved: 0,
          durationMs: Date.now() - start,
        };
      }
    }

    throw new Error('No CLI tool or gateway fallback available');
  }

  totalCostSaved(): number {
    return this.savings;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/cost-router.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add src/swarm/cost-router.ts src/swarm/cost-router.test.ts
git commit -m "feat(swarm): add V3 cost-aware router — CLI first, AI Gateway fallback"
```

---

## Task 6: Agent Definitions File

**Files:**
- Create: `agents-swarm.json`

- [ ] **Step 1: Create agents-swarm.json with CLI-first config**

```json
{
  "version": "2.0.0",
  "description": "Ruflo V3 swarm agents — CLI-first, AI Gateway fallback",
  "costStrategy": "cli-first",
  "agents": [
    {
      "name": "coordinator",
      "identity": { "name": "Queen", "emoji": "crown" },
      "model": {
        "primary": "claude-cli",
        "fallbacks": ["cf-ai-gw-anthropic/claude-sonnet-4-5"]
      },
      "cli": {
        "tool": "claude",
        "args": ["--dangerously-skip-permissions"],
        "timeout": 180000
      },
      "tools": { "allow": ["task-orchestration", "agent-management", "planning", "delegation"] },
      "sandbox": { "mode": "sandbox", "scope": "shared" },
      "subagents": { "allowAgents": ["architect", "coder", "researcher", "reviewer", "tester"] },
      "systemPrompt": "You are the swarm coordinator. Break tasks into subtasks, delegate to specialist agents, collect and synthesize results. Never implement code directly."
    },
    {
      "name": "architect",
      "identity": { "name": "Architect", "emoji": "building_construction" },
      "model": {
        "primary": "claude-cli",
        "fallbacks": ["gemini-cli", "cf-ai-gw-anthropic/claude-sonnet-4-5"]
      },
      "cli": {
        "tool": "claude",
        "args": ["--dangerously-skip-permissions"],
        "timeout": 120000
      },
      "tools": { "allow": ["system-design", "api-design", "architecture-review"] },
      "sandbox": { "mode": "sandbox", "scope": "agent" },
      "subagents": { "allowAgents": [] }
    },
    {
      "name": "coder",
      "identity": { "name": "Coder", "emoji": "keyboard" },
      "model": {
        "primary": "codex-cli",
        "fallbacks": ["claude-cli", "cf-ai-gw-openai/codex-mini"]
      },
      "cli": {
        "tool": "codex",
        "args": ["--quiet"],
        "timeout": 120000
      },
      "tools": { "deny": ["admin", "deployment", "agent-management"] },
      "sandbox": { "mode": "sandbox", "scope": "agent" },
      "workspace": "/root/clawd",
      "subagents": { "allowAgents": [] }
    },
    {
      "name": "researcher",
      "identity": { "name": "Researcher", "emoji": "mag" },
      "model": {
        "primary": "gemini-cli",
        "fallbacks": ["claude-cli", "cf-ai-gw-workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast"]
      },
      "cli": {
        "tool": "gemini",
        "timeout": 120000
      },
      "tools": { "allow": ["web-search", "documentation-lookup", "summarization"] },
      "sandbox": { "mode": "sandbox", "scope": "agent" },
      "subagents": { "allowAgents": [] }
    },
    {
      "name": "reviewer",
      "identity": { "name": "Reviewer", "emoji": "shield" },
      "model": {
        "primary": "claude-cli",
        "fallbacks": ["cf-ai-gw-anthropic/claude-sonnet-4-5"]
      },
      "cli": {
        "tool": "claude",
        "args": ["--dangerously-skip-permissions"],
        "timeout": 120000
      },
      "tools": { "allow": ["code-review", "security-audit", "performance-analysis"] },
      "sandbox": { "mode": "sandbox", "scope": "agent" },
      "subagents": { "allowAgents": [] }
    },
    {
      "name": "tester",
      "identity": { "name": "Tester", "emoji": "test_tube" },
      "model": {
        "primary": "codex-cli",
        "fallbacks": ["claude-cli", "cf-ai-gw-workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast"]
      },
      "cli": {
        "tool": "codex",
        "args": ["--quiet"],
        "timeout": 120000
      },
      "tools": { "allow": ["test-generation", "test-execution", "coverage-analysis"] },
      "sandbox": { "mode": "sandbox", "scope": "agent" },
      "subagents": { "allowAgents": [] }
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add agents-swarm.json
git commit -m "feat(swarm): add CLI-first agent definitions with V3 cost routing"
```

---

## Task 7: Startup Patch + Swarm Routes

**Files:**
- Modify: `start-openclaw.sh` — inject agents.list from agents-swarm.json
- Modify: `Dockerfile` — COPY agents-swarm.json
- Create: `src/routes/swarm.ts`
- Modify: `src/index.ts` — mount swarm routes
- Update: `src/swarm/index.ts` — export all modules

- [ ] **Step 1: Add agents-swarm.json COPY to Dockerfile**

After the `COPY skills/` line:

```dockerfile
# Copy swarm agent definitions
COPY agents-swarm.json /app/agents-swarm.json
```

- [ ] **Step 2: Add agents.list injection to start-openclaw.sh**

In the node patch section (after the Slack config, before "Remove stale keys"), add:

```javascript
// Swarm agents — inject agents.list from agents-swarm.json
try {
    var swarmPath = '/app/agents-swarm.json';
    if (fs.existsSync(swarmPath)) {
        var swarmDefs = JSON.parse(fs.readFileSync(swarmPath, 'utf8'));
        config.agents = config.agents || {};
        config.agents.list = (swarmDefs.agents || []).map(function(a) {
            var entry = { name: a.name, identity: a.identity, model: a.model };
            if (a.tools) entry.tools = a.tools;
            if (a.sandbox) entry.sandbox = a.sandbox;
            if (a.subagents) entry.subagents = a.subagents;
            if (a.workspace) entry.workspace = a.workspace;
            if (a.systemPrompt) entry.systemPrompt = a.systemPrompt;
            return entry;
        });
        console.log('Swarm agents injected: ' + config.agents.list.length + ' agents');
    }
} catch (e) {
    console.warn('Swarm agent injection failed:', e.message);
}
```

- [ ] **Step 3: Create swarm status route**

```typescript
// src/routes/swarm.ts
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware } from '../auth';
import { ensureOpenClawGateway } from '../gateway';

const swarm = new Hono<AppEnv>();
swarm.use('*', createAccessMiddleware({ type: 'json' }));

// GET /api/admin/swarm/status
swarm.get('/status', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    await ensureOpenClawGateway(sandbox, c.env);
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    const config = JSON.parse(configResult.stdout?.trim() ?? '{}');
    const agents = config?.agents?.list ?? [];
    const providers = Object.keys(config?.models?.providers ?? {});

    // Check which CLI tools are available
    const cliCheck = await sandbox.exec(
      'echo "claude:$(which claude 2>/dev/null || echo missing)"; ' +
      'echo "codex:$(which codex 2>/dev/null || echo missing)"; ' +
      'echo "gemini:$(which gemini 2>/dev/null || echo missing)"'
    );
    const cliStatus: Record<string, boolean> = {};
    for (const line of (cliCheck.stdout ?? '').split('\n')) {
      const [tool, path] = line.split(':');
      if (tool) cliStatus[tool] = !path?.includes('missing');
    }

    return c.json({
      swarmEnabled: agents.length > 0,
      costStrategy: 'cli-first',
      agents: agents.map((a: { name: string; model: { primary: string } }) => ({
        name: a.name,
        model: a.model?.primary,
      })),
      cliTools: cliStatus,
      gatewayProviders: providers,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Unknown' }, 500);
  }
});

// GET /api/admin/swarm/memory/stats
swarm.get('/memory/stats', async (c) => {
  const kv = c.env.SWARM_KV;
  if (!kv) return c.json({ error: 'SWARM_KV not configured' }, 503);

  const { keys } = await kv.list({ prefix: 'swarm:' });
  return c.json({
    totalEntries: keys.length,
    agents: [...new Set(keys.map((k: { name: string }) => k.name.split(':')[1]))],
  });
});

export { swarm };
```

- [ ] **Step 4: Mount in index.ts**

In `src/index.ts`, after the existing api route mount (line 243):

```typescript
import { swarm as swarmRoutes } from './routes/swarm';
// ... mount after api routes:
api.route('/admin/swarm', swarmRoutes);
```

- [ ] **Step 5: Update swarm/index.ts exports**

```typescript
// src/swarm/index.ts
export { buildAgentsConfig, validateSwarmAgent } from './config';
export { buildCliCommand, parseCliOutput, estimateCostSavings, runCliInSandbox, resolveCliTool } from './cli-runner';
export { HybridMemory } from './memory';
export { CostAwareRouter } from './cost-router';
export type * from './types';
```

- [ ] **Step 6: Commit**

```bash
cd /Users/aloe/Development/claw-deploy
git add start-openclaw.sh Dockerfile src/routes/swarm.ts src/index.ts src/swarm/index.ts
git commit -m "feat(swarm): wire up startup injection, routes, and full module exports"
```

---

## Task 8: Full Test Suite + Verification

- [ ] **Step 1: Run all swarm tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run src/swarm/`
Expected: All pass

- [ ] **Step 2: Run full project tests**

Run: `cd /Users/aloe/Development/claw-deploy && npx vitest run`
Expected: All pass

- [ ] **Step 3: Type check**

Run: `cd /Users/aloe/Development/claw-deploy && npx tsc --noEmit`
Expected: No errors

---

## Summary

### Routing Priority (V3 Cost Pattern)
```
Request → CLI available? ──YES──→ CLI tool (FREE via OAuth) ──→ Done
              │
              NO
              │
              ▼
         AI Gateway fallback ($$$) ──→ Done
```

### Agent → Tool Mapping
| Agent | Primary CLI | Fallback CLI | Gateway Fallback |
|-------|------------|-------------|------------------|
| Coordinator | `claude` | — | Anthropic Sonnet |
| Architect | `claude` | `gemini` | Anthropic Sonnet |
| Coder | `codex` | `claude` | OpenAI Codex |
| Researcher | `gemini` | `claude` | Workers AI Llama |
| Reviewer | `claude` | — | Anthropic Sonnet |
| Tester | `codex` | `claude` | Workers AI Llama |

### Memory Architecture
```
KV (fast path)              Workers AI Embeddings (semantic path)
┌─────────────┐             ┌──────────────────────┐
│ swarm:agent:key │ ◄──────► │ BGE-base-en-v1.5     │
│ exact lookup    │          │ cosine similarity    │
└─────────────┘             └──────────────────────┘
```
