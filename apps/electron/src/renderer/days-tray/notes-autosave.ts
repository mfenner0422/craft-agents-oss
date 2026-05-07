export interface DebouncedTextSaverOptions {
  initialValue: string
  delayMs: number
  onSave: (value: string) => void
}

export class DebouncedTextSaver {
  private value: string
  private savedValue: string
  private timer: ReturnType<typeof setTimeout> | null = null
  private onSave: (value: string) => void

  constructor(options: DebouncedTextSaverOptions) {
    this.value = options.initialValue
    this.savedValue = options.initialValue
    this.delayMs = options.delayMs
    this.onSave = options.onSave
  }

  private delayMs: number

  setOnSave(onSave: (value: string) => void): void {
    this.onSave = onSave
  }

  reset(value: string): void {
    this.clearTimer()
    this.value = value
    this.savedValue = value
  }

  update(value: string): void {
    this.value = value
    this.clearTimer()
    if (this.value === this.savedValue) return
    this.timer = setTimeout(() => this.flush(), this.delayMs)
  }

  flush(): void {
    this.clearTimer()
    if (this.value === this.savedValue) return
    this.savedValue = this.value
    this.onSave(this.value)
  }

  dispose(): void {
    this.flush()
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
