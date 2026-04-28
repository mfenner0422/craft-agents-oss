/**
 * Rocky 1Password reference resolver.
 *
 * Rocky stores credential placeholders as `op://Rocky/<item>/<field>` and
 * resolves them at credential load. This keeps source/workspace config stable
 * while leaving the actual secret in the Rocky 1Password vault.
 */

import { execFileSync } from 'node:child_process';
import type { StoredCredential } from '../types.ts';

const ROCKY_OP_REF = /^op:\/\/Rocky\/[^/]+\/[^/]+$/;

export function isRockyOnePasswordReference(value: unknown): value is string {
  return typeof value === 'string' && ROCKY_OP_REF.test(value);
}

function canResolveOnePassword(): boolean {
  return Boolean(process.env.OP_SERVICE_ACCOUNT_TOKEN || process.env.OP_CONNECT_TOKEN);
}

export function resolveRockyOnePasswordValue(value: string): string {
  if (!canResolveOnePassword()) {
    throw new Error('Cannot resolve Rocky 1Password reference: OP_SERVICE_ACCOUNT_TOKEN is not set');
  }

  return execFileSync('op', ['read', value], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  }).trimEnd();
}

export function resolveRockyOnePasswordReferences(credential: StoredCredential): StoredCredential {
  const resolved: StoredCredential = { ...credential };

  for (const [key, value] of Object.entries(resolved)) {
    if (isRockyOnePasswordReference(value)) {
      (resolved as unknown as Record<string, unknown>)[key] = resolveRockyOnePasswordValue(value);
    }
  }

  return resolved;
}
