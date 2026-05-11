import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { generateShortId } from '../automations/resolve-config-path.ts';
import { readMarkdown, writeMarkdown } from '../vault/markdown.ts';

export interface CaptureItemInput {
  vaultRoot: string;
  url?: string;
  title?: string;
  faviconUrl?: string;
  body: string;
  tags?: string[];
  now?: Date;
  skipEnrichment?: boolean;
}

export interface CaptureItem {
  id: string;
  filePath: string;
  capturedAt: string;
  url?: string;
  title?: string;
  faviconUrl?: string;
  tags: string[];
  triagedAt?: string;
  body: string;
}

export function captureItem(input: CaptureItemInput): CaptureItem {
  const now = input.now ?? new Date();
  const id = generateShortId();
  const capturedAt = now.toISOString();
  const title = input.title?.trim() || undefined;
  const url = input.url?.trim() || undefined;
  const faviconUrl = input.faviconUrl?.trim() || undefined;
  const slugSource = title || (url ? safeHostname(url) : input.body.slice(0, 48));
  const filename = `${formatTimestamp(now)}-${slugify(slugSource || 'capture')}.md`;
  const inboxDir = join(input.vaultRoot, 'inbox');
  const filePath = join(inboxDir, filename);
  const tags = input.tags ?? [];

  mkdirSync(inboxDir, { recursive: true });
  writeMarkdown(filePath, {
    id,
    captured_at: capturedAt,
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(faviconUrl ? { favicon_url: faviconUrl } : {}),
    tags,
  }, input.body);

  if (url && !input.skipEnrichment) {
    void enrichUrl(url).then(meta => {
      if (!meta.title && !meta.description && !meta.faviconUrl) return;
      writeMarkdown(filePath, {
        id,
        captured_at: capturedAt,
        url,
        ...((title ?? meta.title) ? { title: title ?? meta.title } : {}),
        ...((faviconUrl ?? meta.faviconUrl) ? { favicon_url: faviconUrl ?? meta.faviconUrl } : {}),
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
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    tags,
    body: input.body,
  };
}

export function listInboxItems(vaultRoot: string, limitOrOptions: number | { limit?: number; untriagedOnly?: boolean } = 100): CaptureItem[] {
  const limit = typeof limitOrOptions === 'number' ? limitOrOptions : limitOrOptions.limit ?? 100;
  const untriagedOnly = typeof limitOrOptions === 'object' && limitOrOptions.untriagedOnly === true;
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
        ...(typeof doc.data.url === 'string' ? { url: doc.data.url } : {}),
        ...(typeof doc.data.title === 'string' ? { title: doc.data.title } : {}),
        ...(typeof doc.data.favicon_url === 'string' ? { faviconUrl: doc.data.favicon_url } : {}),
        tags: Array.isArray(doc.data.tags) ? doc.data.tags.map(String) : [],
        ...(typeof doc.data.triaged_at === 'string' ? { triagedAt: doc.data.triaged_at } : {}),
        body: doc.content,
      };
    })
    .filter(item => !untriagedOnly || !item.triagedAt);
}

export function markCaptureTriaged(vaultRoot: string, itemId: string, now = new Date()): CaptureItem {
  const item = readCaptureItem(vaultRoot, itemId);
  if (!item) throw new Error(`Capture item not found: ${itemId}`);
  const doc = readMarkdown(item.filePath);
  const triagedAt = now.toISOString();
  writeMarkdown(item.filePath, { ...doc.data, triaged_at: triagedAt }, doc.content);
  return { ...item, triagedAt };
}

export function deleteCaptureItem(vaultRoot: string, itemId: string): void {
  const inboxDir = join(vaultRoot, 'inbox');
  if (!existsSync(inboxDir)) {
    throw new Error(`Capture item not found: ${itemId}`);
  }

  const match = readdirSync(inboxDir)
    .filter(name => name.endsWith('.md'))
    .map(name => {
      const filePath = join(inboxDir, name);
      const doc = readMarkdown(filePath);
      const id = String(doc.data.id ?? name.replace(/\.md$/, ''));
      return { id, filePath };
    })
    .find(entry => entry.id === itemId);

  if (!match) {
    throw new Error(`Capture item not found: ${itemId}`);
  }

  const resolvedRoot = resolve(vaultRoot);
  const resolvedFile = resolve(match.filePath);
  const rel = relative(resolvedRoot, resolvedFile);
  if (rel.startsWith('..') || rel === '' || resolve(resolvedRoot, rel) !== resolvedFile) {
    throw new Error(`Refusing to delete capture file outside vault: ${match.filePath}`);
  }

  unlinkSync(resolvedFile);
}

function readCaptureItem(vaultRoot: string, itemId: string): CaptureItem | null {
  const inboxDir = join(vaultRoot, 'inbox');
  if (!existsSync(inboxDir)) return null;
  for (const name of readdirSync(inboxDir).filter(name => name.endsWith('.md'))) {
    const filePath = join(inboxDir, name);
    const doc = readMarkdown(filePath);
    const id = String(doc.data.id ?? name.replace(/\.md$/, ''));
    if (id !== itemId) continue;
    return {
      id,
      filePath,
      capturedAt: String(doc.data.captured_at ?? ''),
      ...(typeof doc.data.url === 'string' ? { url: doc.data.url } : {}),
      ...(typeof doc.data.title === 'string' ? { title: doc.data.title } : {}),
      ...(typeof doc.data.favicon_url === 'string' ? { faviconUrl: doc.data.favicon_url } : {}),
      tags: Array.isArray(doc.data.tags) ? doc.data.tags.map(String) : [],
      ...(typeof doc.data.triaged_at === 'string' ? { triagedAt: doc.data.triaged_at } : {}),
      body: doc.content,
    };
  }
  return null;
}

export interface EnrichResult {
  title?: string;
  description?: string;
  author?: string;
  site?: string;
  faviconUrl?: string;
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
    const faviconUrl = extractFaviconUrl(html, parsed);

    const { Defuddle } = await import('defuddle/node');
    const result = await Defuddle(html, parsed.toString(), { markdown: true });

    return {
      title: result.title || undefined,
      description: result.description || undefined,
      author: result.author || undefined,
      site: result.site || undefined,
      faviconUrl,
      contentMarkdown: result.content || undefined,
      wordCount: result.wordCount || undefined,
      published: result.published || undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractFaviconUrl(html: string, pageUrl: URL): string | undefined {
  const linkPattern = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0] ?? '';
    const rel = getHtmlAttribute(tag, 'rel')?.toLowerCase();
    if (!rel?.split(/\s+/).some(value => value === 'icon' || value === 'shortcut icon' || value === 'apple-touch-icon')) {
      continue;
    }
    const href = getHtmlAttribute(tag, 'href');
    if (!href) continue;
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

function getHtmlAttribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`, 'i');
  const match = tag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined;
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
