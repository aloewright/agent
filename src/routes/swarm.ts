import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware } from '../auth';
import { ensureOpenClawGateway } from '../gateway';

const swarm = new Hono<AppEnv>();
swarm.use('*', createAccessMiddleware({ type: 'json' }));

// GET /status — Swarm overview
swarm.get('/status', async (c) => {
  const sandbox = c.get('sandbox');
  try {
    await ensureOpenClawGateway(sandbox, c.env);
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
  const { keys } = await kv.list({ prefix: 'swarm:' });
  return c.json({
    totalEntries: keys.length,
    agents: [...new Set(keys.map((k: { name: string }) => k.name.split(':')[1]))],
  });
});

export { swarm };
