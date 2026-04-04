import { Hono } from 'hono';
import type { AppEnv } from '../types';

const swarm = new Hono<AppEnv>();

// GET /status — Swarm overview
swarm.get('/status', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    // Read config file directly without ensuring gateway is running
    const configResult = await sandbox.exec('cat /root/.openclaw/openclaw.json 2>/dev/null || echo "{}"');
    const config = JSON.parse(configResult.stdout?.trim() ?? '{}');
    const agents = config?.agents?.list ?? [];
    const providers = Object.keys(config?.models?.providers ?? {});

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

// GET /memory/stats — Memory usage
swarm.get('/memory/stats', async (c) => {
  const kv = c.env.SWARM_KV;
  if (!kv) return c.json({ error: 'SWARM_KV not configured' }, 503);

  try {
    let cursor: string | undefined;
    const allKeys: Array<{ name: string }> = [];
    do {
      const result = await kv.list({ prefix: 'swarm:', cursor });
      allKeys.push(...result.keys);
      cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return c.json({
      totalEntries: allKeys.length,
      agents: [...new Set(allKeys.map((k) => k.name.split(':')[1]))],
    });
  } catch (error) {
    console.error('[swarm] KV list failed:', error);
    return c.json({ error: 'Failed to read swarm memory' }, 502);
  }
});

export { swarm };
