import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import matter from 'gray-matter';
import { atomicWriteFileSync } from '../utils/files.ts';

export interface MarkdownDocument {
  data: Record<string, unknown>;
  content: string;
}

export function readMarkdown(absPath: string): MarkdownDocument {
  const parsed = matter(readFileSync(absPath, 'utf-8'));
  return {
    data: parsed.data as Record<string, unknown>,
    content: parsed.content,
  };
}

export function writeMarkdown(absPath: string, data: Record<string, unknown>, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  atomicWriteFileSync(absPath, matter.stringify(content, data));
}
