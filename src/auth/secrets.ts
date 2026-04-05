import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/**
 * Middleware: Resolve Secrets Store bindings into plain strings.
 *
 * Secrets Store bindings are objects with a .get() method; regular secrets are strings.
 * This resolves them early so all downstream code can read env vars as plain strings.
 */
export const secretsMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const secretKeys = [
    'CF_ACCESS_TEAM_DOMAIN',
    'CF_ACCESS_AUD',
    'CF_AI_GATEWAY_ACCOUNT_ID',
    'CF_AI_GATEWAY_GATEWAY_ID',
    'CF_AI_GATEWAY_MODEL',
    'CLOUDFLARE_AI_GATEWAY_API_KEY',
    'CF_ACCOUNT_ID',
    'DEBUG_ROUTES',
    'OPENCLAW_GATEWAY_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'CLAW_MESSENGER_API_KEY',
  ] as const;

  await Promise.all(
    secretKeys.map(async (key) => {
      const val = (c.env as unknown as Record<string, unknown>)[key];
      if (
        val &&
        typeof val === 'object' &&
        'get' in val &&
        typeof (val as { get: unknown }).get === 'function'
      ) {
        (c.env as unknown as Record<string, unknown>)[key] = await (
          val as { get: () => Promise<string> }
        ).get();
      }
    }),
  );

  await next();
};
