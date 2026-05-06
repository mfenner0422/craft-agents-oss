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
  skipEnrichment?: boolean;
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

  if (url && !input.skipEnrichment) {
    void enrichUrl(url).then(meta => {
      if (!meta.title && !meta.description) return;
      writeMarkdown(filePath, {
        id,
        captured_at: capturedAt,
        source: input.source,
        url,
        title: title ?? meta.title,
        ...(meta.description ? { description: meta.description } : {}),
        tags,
      }, input.body);
    }).catch(() => {
      // URL enrichment is best-effort; capture creation has already succeeded.
    });
  }

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

export interface EnrichResult {
  title?: string;
  description?: string;
  author?: string;
  site?: string;
  contentMarkdown?: string;
  wordCount?: number;
  published?: string;
}

export async function enrichUrl(url: string): Promise<EnrichResult> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be enriched');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) return {};
    const html = await response.text();

    const { Defuddle } = await import('defuddle/node');
    const result = await Defuddle(html, parsed.toString(), { markdown: true });

    return {
      title: result.title || undefined,
      description: result.description || undefined,
      author: result.author || undefined,
      site: result.site || undefined,
      contentMarkdown: result.content || undefined,
      wordCount: result.wordCount || undefined,
      published: result.published || undefined,
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

