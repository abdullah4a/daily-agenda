// Dependency-free PNG icon generator: node scripts/generate-icons.mjs
// Draws a flat muted indigo tile with a calendar glyph. "maskable" fills the whole canvas.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// Signed distance to a rounded rect centred at (cx,cy) with half-size (hw,hh) and radius r.
function sdRound(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r)
  const dy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r
}

function icon(size, maskable) {
  return png(size, (x, y) => {
    const u = (x + 0.5) / size, v = (y + 0.5) / size
    // background tile
    let a = 255
    if (!maskable) {
      const d = sdRound(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) * size
      a = Math.round(255 * Math.min(1, Math.max(0, 0.5 - d)))
    }
    if (a === 0) return [0, 0, 0, 0]
    let rgb = [77, 80, 158]
    // glyph scale: maskable keeps content inside the 80% safe zone
    const s = maskable ? 0.62 : 0.74
    const gx = (u - 0.5) / s + 0.5, gy = (v - 0.5) / s + 0.5
    const body = sdRound(gx, gy, 0.5, 0.55, 0.34, 0.31, 0.07) * size * s
    const cover = Math.min(1, Math.max(0, 0.5 - body))
    if (cover > 0) {
      // header band + check dots inside the card
      const inHeader = gy < 0.4
      const card = inHeader ? [255, 255, 255, 0.95] : [255, 255, 255, 0.96]
      const dots = [[0.36, 0.52], [0.5, 0.52], [0.64, 0.52], [0.36, 0.66], [0.5, 0.66]]
      let dot = false
      for (const [dx, dy] of dots) if (Math.hypot(gx - dx, gy - dy) < 0.036) dot = true
      let c = card
      if (inHeader) c = [199, 210, 254, 1]
      if (dot) c = [79, 70, 229, 1]
      rgb = rgb.map((ch, i) => ch * (1 - cover * c[3]) + c[i] * cover * c[3])
    }
    // binder rings
    for (const rx of [0.34, 0.66]) {
      const ring = sdRound(gx, gy, rx, 0.25, 0.022, 0.06, 0.022) * size * s
      const rc = Math.min(1, Math.max(0, 0.5 - ring))
      if (rc > 0) rgb = rgb.map((ch, i) => ch * (1 - rc) + [255, 255, 255][i] * rc)
    }
    return [...rgb.map(Math.round), a]
  })
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', icon(192, false))
writeFileSync('public/icons/icon-512.png', icon(512, false))
writeFileSync('public/icons/maskable-512.png', icon(512, true))
writeFileSync('public/icons/apple-touch-icon.png', icon(180, true))
writeFileSync('public/favicon.png', icon(64, false))
console.log('icons written')
