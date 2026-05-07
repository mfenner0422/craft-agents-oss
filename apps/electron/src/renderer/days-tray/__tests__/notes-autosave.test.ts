import { describe, expect, it } from 'bun:test'
import { DebouncedTextSaver } from '../notes-autosave'

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('DebouncedTextSaver', () => {
  it('saves only the latest value after rapid updates', async () => {
    const saves: string[] = []
    const saver = new DebouncedTextSaver({
      initialValue: 'start',
      delayMs: 5,
      onSave: value => saves.push(value),
    })

    saver.update('starta')
    saver.update('startab')
    saver.update('startabc')
    await wait(15)

    expect(saves).toEqual(['startabc'])
  })

  it('flushes the latest dirty value on dispose', () => {
    const saves: string[] = []
    const saver = new DebouncedTextSaver({
      initialValue: 'start',
      delayMs: 1000,
      onSave: value => saves.push(value),
    })

    saver.update('latest')
    saver.dispose()

    expect(saves).toEqual(['latest'])
  })

  it('reset cancels pending saves for old content', async () => {
    const saves: string[] = []
    const saver = new DebouncedTextSaver({
      initialValue: 'old',
      delayMs: 5,
      onSave: value => saves.push(value),
    })

    saver.update('dirty old')
    saver.reset('new day')
    await wait(15)

    expect(saves).toEqual([])
  })
})
