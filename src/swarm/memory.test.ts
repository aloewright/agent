import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HybridMemory } from './memory';

function mockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      const keys = Array.from(store.keys()).filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys };
    }),
  };
}

function mockAI() {
  return { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] })) };
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
