import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateShortId } from '../automations/resolve-config-path.ts';
import { readMarkdown, writeMarkdown } from '../vault/markdown.ts';

export interface CaptureItemInput {
  vaultRoot: string;
  source: string;
  url?: string;
  title?: string;
  body: string;
  tags?: string[];
  now?: Date;
}

export interface CaptureItem {
  id: string;
  filePath: string;
  capturedAt: string;
  source: string;
  url?: string;
  title?: string;
  tags: string[];
  body: string;
}

export function captureItem(input: CaptureItemInput): CaptureItem {
  const now = input.now ?? new Date();
  const id = generateShortId();
  const capturedAt = now.toISOString();
  const title = input.title?.trim() || undefined;
  const url = input.url?.trim() || undefined;
  const slugSource = title || (url ? safeHostname(url) : input.body.slice(0, 48));
  const filename = `${formatTimestamp(now)}-${slugify(slugSource || 'capture')}.md`;
  const inboxDir = join(input.vaultRoot, 'inbox');
  const filePath = join(inboxDir, filename);
  const tags = input.tags ?? [];

  mkdirSync(inboxDir, { recursive: true });
  writeMarkdown(filePath, {
    id,
    captured_at: capturedAt,
    source: input.source,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    tags,
  }, input.body);

  return {
    id,
    filePath,
    capturedAt,
    source: input.source,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    tags,
    body: input.body,
  };
}

export function listInboxItems(vaultRoot: string, limit = 100): CaptureItem[] {
  const inboxDir = join(vaultRoot, 'inbox');
  if (!existsSync(inboxDir)) return [];
  return readdirSync(inboxDir)
    .filter(name => name.endsWith('.md'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit)
    .map(name => {
      const filePath = join(inboxDir, name);
      const doc = readMarkdown(filePath);
      return {
        id: String(doc.data.id ?? name.replace(/\.md$/, '')),
        filePath,
        capturedAt: String(doc.data.captured_at ?? ''),
        source: String(doc.data.source ?? 'manual'),
        ...(typeof doc.data.url === 'string' ? { url: doc.data.url } : {}),
        ...(typeof doc.data.title === 'string' ? { title: doc.data.title } : {}),
        tags: Array.isArray(doc.data.tags) ? doc.data.tags.map(String) : [],
        body: doc.content,
      };
    });
}

export async function enrichUrl(url: string): Promise<{ title?: string; description?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const html = await response.text();
    return {
      title: matchMeta(html, /<title[^>]*>([^<]*)<\/title>/i),
      description: matchMeta(html, /<meta\s+name=["']description["']\s+content=["']([^"']*)["'][^>]*>/i),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'capture';
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'capture';
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function matchMeta(html: string, pattern: RegExp): string | undefined {
  const value = html.match(pattern)?.[1]?.trim();
  return value ? decodeHtml(value) : undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
