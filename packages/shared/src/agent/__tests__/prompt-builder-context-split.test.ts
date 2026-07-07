/**
 * Guards the volatile/stable context split (issue #862).
 *
 * The Pi adapter folded volatile context (date/time, session_state, sources)
 * into the cached system prefix, re-stamping it every turn and killing
 * prompt-cache reuse. The fix splits PromptBuilder.buildContextParts() into
 * buildVolatileContextParts() + buildStableContextParts() so the Pi path can
 * keep stable blocks in the system prompt and route volatile blocks to the user
 * tail (where the Claude path already puts everything).
 *
 * These tests pin three invariants:
 *  1. buildContextParts === [...volatile, ...stable] — the Claude path output is
 *     unchanged (same blocks, same order).
 *  2. Blocks are routed correctly: session_state + sources are volatile;
 *     workspace capabilities is stable.
 *  3. Mode-change/session-state signals are kept out of the stable builder.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { TestAgent, createMockBackendConfig, createMockSession } from './test-utils.ts'
import { cleanupModeState } from '../mode-manager.ts'

const SESSION_ID = 'prompt-builder-context-split-session'
const OPTS = { plansFolderPath: '/tmp/plans', dataFolderPath: '/tmp/data' }
const SOURCE_BLOCK = '<sources>\nActive: none\n</sources>'

function makeBuilder() {
  return new TestAgent(createMockBackendConfig({
    session: createMockSession({ id: SESSION_ID }),
  })).getPromptBuilder()
}

describe('PromptBuilder volatile/stable context split (issue #862)', () => {
  afterEach(() => cleanupModeState(SESSION_ID))

  it('buildContextParts equals [...volatile, ...stable] (Claude path stays byte-identical)', () => {
    // No pending one-shot signal → consume is a no-op → repeated calls are stable.
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const composed = [
      ...builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK),
      ...builder.buildStableContextParts(),
    ]
    const combined = builder.buildContextParts(OPTS, SOURCE_BLOCK)
    expect(combined).toEqual(composed)
  })

  it('routes session_state + sources to volatile and workspace capabilities to stable', () => {
    cleanupModeState(SESSION_ID)
    const builder = makeBuilder()
    const volatileText = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')
    const stableText = builder.buildStableContextParts().join('\n')

    // session_state + source ride the volatile tail
    expect(volatileText).toContain('permissionMode:')
    expect(volatileText).toContain(SOURCE_BLOCK)
    // workspace capabilities is stable
    expect(stableText).toContain('<workspace_capabilities>')

    // The halves must not bleed into each other
    expect(volatileText).not.toContain('<workspace_capabilities>')
    expect(stableText).not.toContain('permissionMode:')
  })

  it('keeps mode-change/session-state signals out of the stable path', () => {
    const builder = makeBuilder()
    cleanupModeState(SESSION_ID)

    const stable = builder.buildStableContextParts().join('\n')
    const volatile = builder.buildVolatileContextParts(OPTS, SOURCE_BLOCK).join('\n')

    expect(stable).not.toContain('<session_state>')
    expect(stable).not.toContain('modeChangeSummary:')
    expect(stable).not.toContain('modeChangeUserSignal:')
    expect(volatile).toContain('<session_state>')
  })
})
