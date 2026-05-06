import { nativeImage, type NativeImage } from 'electron'

const ICON_BASE = 22
const ICON_SCALES: ReadonlyArray<number> = [1, 2]

const cache = new Map<string, NativeImage>()

export function buildCalendarIcon(dayOfMonth: number): NativeImage {
  const cacheKey = String(dayOfMonth)
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const baseSize = ICON_BASE * ICON_SCALES[0]
  const baseBuffer = renderRgba(dayOfMonth, baseSize)
  const image = nativeImage.createFromBuffer(baseBuffer, {
    width: baseSize,
    height: baseSize,
    scaleFactor: ICON_SCALES[0],
  })
  for (const scale of ICON_SCALES.slice(1)) {
    const size = ICON_BASE * scale
    image.addRepresentation({
      scaleFactor: scale,
      buffer: renderRgba(dayOfMonth, size),
      width: size,
      height: size,
    })
  }
  image.setTemplateImage(true)

  cache.set(cacheKey, image)
  return image
}

function renderRgba(dayOfMonth: number, size: number): Buffer {
  const buffer = Buffer.alloc(size * size * 4, 0)
  const text = String(Math.max(1, Math.min(31, Math.floor(dayOfMonth))))
  drawCalendarFrame(buffer, size)
  drawNumber(buffer, size, text)
  return buffer
}

function drawCalendarFrame(buffer: Buffer, size: number): void {
  const inset = Math.max(1, Math.round(size * 0.09))
  const stroke = Math.max(1, Math.round(size / 22))
  const headerHeight = Math.round(size * 0.13)
  const top = inset + headerHeight

  drawRectOutline(buffer, size, inset, top, size - 2 * inset, size - inset - top, stroke)

  const notchHeight = headerHeight + stroke
  const notchWidth = Math.max(1, Math.round(size * 0.08))
  const notchY = inset
  const xLeft = Math.round(size * 0.30) - Math.floor(notchWidth / 2)
  const xRight = Math.round(size * 0.70) - Math.floor(notchWidth / 2)
  fillRect(buffer, size, xLeft, notchY, notchWidth, notchHeight)
  fillRect(buffer, size, xRight, notchY, notchWidth, notchHeight)
}

function drawNumber(buffer: Buffer, size: number, text: string): void {
  const headerOffset = Math.round(size * 0.22)
  const innerHeight = size - headerOffset - Math.round(size * 0.18)
  const charsCount = text.length

  const targetCharHeight = Math.floor(innerHeight * 0.95)
  const pixelScale = Math.max(1, Math.floor(targetCharHeight / 5))
  const charWidth = 3 * pixelScale
  const gap = pixelScale
  const totalWidth = charsCount * charWidth + (charsCount - 1) * gap

  const offsetX = Math.round((size - totalWidth) / 2)
  const offsetY = headerOffset + Math.round((innerHeight - 5 * pixelScale) / 2)

  for (let i = 0; i < charsCount; i++) {
    const digit = text.charCodeAt(i) - 48
    if (digit < 0 || digit > 9) continue
    drawDigit(buffer, size, digit, offsetX + i * (charWidth + gap), offsetY, pixelScale)
  }
}

const DIGIT_BITMAP_5x3: Record<number, ReadonlyArray<ReadonlyArray<number>>> = {
  0: [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
  1: [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],
  2: [[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],
  3: [[1,1,1],[0,0,1],[0,1,1],[0,0,1],[1,1,1]],
  4: [[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
  5: [[1,1,1],[1,0,0],[1,1,1],[0,0,1],[1,1,1]],
  6: [[1,1,1],[1,0,0],[1,1,1],[1,0,1],[1,1,1]],
  7: [[1,1,1],[0,0,1],[0,1,0],[0,1,0],[0,1,0]],
  8: [[1,1,1],[1,0,1],[1,1,1],[1,0,1],[1,1,1]],
  9: [[1,1,1],[1,0,1],[1,1,1],[0,0,1],[1,1,1]],
}

function drawDigit(buffer: Buffer, size: number, digit: number, x: number, y: number, pixelScale: number): void {
  const bitmap = DIGIT_BITMAP_5x3[digit]
  if (!bitmap) return
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (bitmap[row][col]) {
        fillRect(buffer, size, x + col * pixelScale, y + row * pixelScale, pixelScale, pixelScale)
      }
    }
  }
}

function drawRectOutline(buffer: Buffer, size: number, x: number, y: number, w: number, h: number, stroke: number): void {
  fillRect(buffer, size, x, y, w, stroke)
  fillRect(buffer, size, x, y + h - stroke, w, stroke)
  fillRect(buffer, size, x, y, stroke, h)
  fillRect(buffer, size, x + w - stroke, y, stroke, h)
}

function fillRect(buffer: Buffer, size: number, x: number, y: number, w: number, h: number): void {
  for (let yi = y; yi < y + h; yi++) {
    if (yi < 0 || yi >= size) continue
    for (let xi = x; xi < x + w; xi++) {
      if (xi < 0 || xi >= size) continue
      const offset = (yi * size + xi) * 4
      buffer[offset] = 0
      buffer[offset + 1] = 0
      buffer[offset + 2] = 0
      buffer[offset + 3] = 255
    }
  }
}
