import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RenderTemplateOptions {
  vaultRoot: string;
  bundledRoot: string;
}

export function renderTemplate(slug: string, vars: Record<string, string>, options: RenderTemplateOptions): string {
  const overridePath = join(options.vaultRoot, '_templates', slug);
  const bundledPath = join(options.bundledRoot, slug);
  const templatePath = existsSync(overridePath) ? overridePath : bundledPath;
  const template = existsSync(templatePath) ? readFileSync(templatePath, 'utf-8') : '';

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}
