import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Stub the preferences module so we can toggle `getCoAuthorPreference` per test
// without touching disk. `formatPreferencesForPrompt` is stubbed to '' because
// it's unrelated to the behavior under test here.
let mockIncludeCoAuthoredBy = true
mock.module('../../config/preferences.ts', () => ({
  getCoAuthorPreference: () => mockIncludeCoAuthoredBy,
  formatPreferencesForPrompt: () => '',
}))

import { resolveVaultRoot } from '../../vault/path.ts'
import type { WorkspaceConfig } from '../../workspaces/types.ts'
import { buildRockySystemPrompt, buildVaultSystemPrompt, getSystemPrompt } from '../system'

const GIT_CONVENTIONS_HEADING = '## Git Conventions'
const CO_AUTHOR_TRAILER = 'Co-Authored-By: Craft Agent <agents-noreply@craft.do>'
const tempDirs: string[] = []

function tempWorkspace(prefix = 'system-prompt-'): string {
  const workspace = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(workspace)
  return workspace
}

function writeWorkspaceConfig(workspace: string, config: Partial<WorkspaceConfig> = {}): void {
  const fullConfig: WorkspaceConfig = {
    id: 'test-workspace',
    name: 'Test Workspace',
    slug: 'test-workspace',
    createdAt: 0,
    updatedAt: 0,
    ...config,
  }
  writeFileSync(join(workspace, 'config.json'), JSON.stringify(fullConfig, null, 2))
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('system prompt guidance', () => {
  it('uses backend-neutral debug log querying guidance (rg/grep via Bash)', () => {
    const prompt = getSystemPrompt(
      undefined,
      { enabled: true, logFilePath: '/tmp/main.log' },
      '/tmp/workspace',
      '/tmp/workspace'
    )

    expect(prompt).toContain('Use Bash with `rg`/`grep` to search logs efficiently:')
    expect(prompt).toContain('rg -n "session" "/tmp/main.log"')
    expect(prompt).not.toContain('Use the Grep tool (if available)')
    expect(prompt).not.toContain('Grep pattern=')
  })

  it('does not mention Grep in call_llm tool-dependency guidance', () => {
    const prompt = getSystemPrompt(undefined, undefined, '/tmp/workspace', '/tmp/workspace')

    expect(prompt).toContain('The subtask needs file/shell tools (for example, Read or Bash)')
    expect(prompt).not.toContain('The subtask needs tools (Read, Bash, Grep)')
  })
})

describe('includeCoAuthoredBy handling', () => {
  beforeEach(() => {
    mockIncludeCoAuthoredBy = true
  })

  it('includes the Git Conventions block when the arg is explicitly true', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      undefined,
      true
    )

    expect(prompt).toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).toContain(CO_AUTHOR_TRAILER)
  })

  it('omits the Git Conventions block when the arg is explicitly false', () => {
    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      undefined,
      false
    )

    expect(prompt).not.toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).not.toContain(CO_AUTHOR_TRAILER)
  })

  // Regression test for #576: Pi-backed sessions called getSystemPrompt without
  // the 7th arg, and the function silently defaulted to `true`, ignoring the
  // user's preference. The defensive fallback in getSystemPrompt should now
  // resolve to getCoAuthorPreference() when the arg is omitted.
  it('falls back to getCoAuthorPreference() when the arg is omitted (#576)', () => {
    mockIncludeCoAuthoredBy = false

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace',
      undefined,
      'Craft Agents Backend'
      // 7th arg omitted — must not regress to `true` default
    )

    expect(prompt).not.toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).not.toContain(CO_AUTHOR_TRAILER)
  })

  it('falls back to getCoAuthorPreference() === true when the arg is omitted and the user has not opted out', () => {
    mockIncludeCoAuthoredBy = true

    const prompt = getSystemPrompt(
      undefined,
      undefined,
      '/tmp/workspace',
      '/tmp/workspace'
    )

    expect(prompt).toContain(GIT_CONVENTIONS_HEADING)
    expect(prompt).toContain(CO_AUTHOR_TRAILER)
  })
})

describe('Rocky system prompt context', () => {
  it('injects Rocky files when present', () => {
    const workspace = tempWorkspace('rocky-system-')
    mkdirSync(join(workspace, 'memories'))
    writeFileSync(join(workspace, 'AGENTS.md'), 'Operational harness')
    writeFileSync(join(workspace, 'SOUL.md'), 'Persona shape')
    writeFileSync(join(workspace, 'memories', 'USER.md'), 'Micah profile')
    writeFileSync(join(workspace, 'memories', 'MEMORY.md'), 'Durable fact')

    const prompt = getSystemPrompt(undefined, undefined, workspace, workspace)

    expect(prompt).toContain('## Rocky Workspace Context')
    expect(prompt).toContain('# AGENTS.md')
    expect(prompt).toContain('Operational harness')
    expect(prompt).toContain('# memories/MEMORY.md')
    expect(prompt).toContain('Durable fact')
  })

  it('ignores non-Rocky workspaces', () => {
    const workspace = tempWorkspace('plain-system-')

    expect(buildRockySystemPrompt(workspace)).toBe('')
  })

  it('rejects Rocky context above 10KB', () => {
    const workspace = tempWorkspace('rocky-large-system-')
    mkdirSync(join(workspace, 'memories'))
    writeFileSync(join(workspace, 'memories', 'MEMORY.md'), 'x'.repeat(11 * 1024))

    expect(() => buildRockySystemPrompt(workspace)).toThrow('Rocky system prompt exceeds 10KB')
  })
})

describe('Vault system prompt context', () => {
  it('returns empty when workspaceRootPath is undefined', () => {
    expect(buildVaultSystemPrompt()).toBe('')
  })

  it('returns empty when neither days nor capture is enabled', () => {
    const workspace = tempWorkspace('vault-disabled-system-')
    writeWorkspaceConfig(workspace, {
      days: { enabled: false },
      capture: { enabled: false },
    })

    expect(buildVaultSystemPrompt(workspace)).toBe('')
  })

  it('returns empty when vault path resolution fails', () => {
    const workspace = tempWorkspace('vault-blocked-system-')
    writeFileSync(join(workspace, 'blocked'), 'not a dir')
    writeWorkspaceConfig(workspace, {
      vault: { path: 'blocked/vault' },
      capture: { enabled: true },
    })

    expect(() => buildVaultSystemPrompt(workspace)).not.toThrow()
    expect(buildVaultSystemPrompt(workspace)).toBe('')
  })

  it('includes a vault block when only days is enabled', () => {
    const workspace = tempWorkspace('vault-days-system-')
    writeWorkspaceConfig(workspace, {
      days: { enabled: true },
    })

    const prompt = buildVaultSystemPrompt(workspace)

    expect(prompt).toContain('## Vault')
    expect(prompt).toContain('<vault>')
    expect(prompt).toContain(`root: ${join(workspace, 'vault')}`)
    expect(prompt).toContain(`Read ${join(workspace, 'vault')}/daily/next.md`)
  })

  it('includes a vault block when only capture is enabled', () => {
    const workspace = tempWorkspace('vault-capture-system-')
    writeWorkspaceConfig(workspace, {
      capture: { enabled: true },
    })

    const prompt = buildVaultSystemPrompt(workspace)

    expect(prompt).toContain('## Vault')
    expect(prompt).toContain('<vault>')
    expect(prompt).toContain(`Glob ${join(workspace, 'vault')}/inbox/*.md`)
    expect(prompt).toContain(`Grep ${join(workspace, 'vault')}/inbox/`)
  })

  it('contains the resolved absolute vault root', () => {
    const workspace = tempWorkspace('vault-custom-root-system-')
    writeWorkspaceConfig(workspace, {
      vault: { path: 'notes/vault' },
      capture: { enabled: true },
    })
    const root = resolveVaultRoot(workspace, { vault: { path: 'notes/vault' } })

    expect(buildVaultSystemPrompt(workspace)).toContain(`root: ${root}`)
  })

  it('is byte-identical across calls with unchanged config', () => {
    const workspace = tempWorkspace('vault-stable-system-')
    writeWorkspaceConfig(workspace, {
      days: { enabled: true },
      capture: { enabled: true },
    })

    expect(buildVaultSystemPrompt(workspace)).toBe(buildVaultSystemPrompt(workspace))
  })

  it('inserts vault context after Rocky context and before preferences', () => {
    const workspace = tempWorkspace('vault-order-system-')
    writeFileSync(join(workspace, 'AGENTS.md'), 'Operational harness')
    writeWorkspaceConfig(workspace, {
      capture: { enabled: true },
    })

    const prompt = getSystemPrompt(
      '\n\n## User Preferences\n\nPrefer concise responses.',
      undefined,
      workspace,
      workspace
    )

    const rockyIndex = prompt.indexOf('## Rocky Workspace Context')
    const vaultIndex = prompt.indexOf('## Vault')
    const preferencesIndex = prompt.indexOf('## User Preferences')

    expect(rockyIndex).toBeGreaterThanOrEqual(0)
    expect(vaultIndex).toBeGreaterThan(rockyIndex)
    expect(preferencesIndex).toBeGreaterThan(vaultIndex)
    expect(prompt.match(/<vault>/g)).toHaveLength(1)
  })
})
