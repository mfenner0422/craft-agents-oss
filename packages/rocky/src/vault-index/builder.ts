import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const EXCLUDED_DIRS = new Set(['.git', '.qmd', '.tools', '_externals', 'node_modules', 'sessions', 'state']);

export interface VaultIndexFile {
  path: string;
  title: string;
  links: string[];
  tags: string[];
  chars: number;
  updatedAt: string;
}

export interface VaultIndex {
  generatedAt: string;
  fileCount: number;
  files: VaultIndexFile[];
}

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

function titleFor(text: string, path: string): string {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.replace(/\.md$/, '').split('/').pop() ?? path;
}

function wikilinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
}

function tags(text: string): string[] {
  return [...text.matchAll(/(^|\s)#([a-zA-Z][\w/-]*)/g)]
    .map((match) => `#${match[2]}`)
    .sort();
}

export async function rebuildVaultIndex(workspaceRoot: string): Promise<VaultIndex> {
  const files = walk(workspaceRoot)
    .map((fullPath) => {
      const path = relative(workspaceRoot, fullPath);
      const text = readFileSync(fullPath, 'utf8');
      return {
        path,
        title: titleFor(text, path),
        links: wikilinks(text),
        tags: tags(text),
        chars: text.length,
        updatedAt: statSync(fullPath).mtime.toISOString(),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const index: VaultIndex = {
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    files,
  };

  writeFileSync(join(workspaceRoot, '.vault-index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
