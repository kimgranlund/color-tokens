/**
 * Minimal ZIP writer — STORE method (no compression), zero-dep (D-17). Bundles a
 * few small text files into ONE Blob so the UI can deliver multiple files in a
 * single reliable download (the Figma Light/Dark pair — D-42: two rapid
 * `<a download>` clicks get blocked / prompt for "multiple files"; one .zip does not).
 * Not a general-purpose ZIP — store-only, no Zip64, ASCII/UTF-8 names.
 */

const DOS_TIME = 0
const DOS_DATE = 0x21 // 1980-01-01 (a valid fixed timestamp → deterministic output)

/** CRC-32 (IEEE 802.3) of a byte array. @param {Uint8Array} bytes @returns {number} */
function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** @param {number} size @param {(v: DataView) => void} fill @returns {Uint8Array} */
function record(size, fill) {
  const b = new Uint8Array(size)
  fill(new DataView(b.buffer))
  return b
}

/** Build a ZIP Blob from `{ name, text }` entries (stored, uncompressed).
 *  @param {{ name: string, text: string }[]} files @returns {Blob} */
export function zipStore(files) {
  const enc = new TextEncoder()
  /** @type {Uint8Array[]} */ const body = []
  /** @type {Uint8Array[]} */ const central = []
  let offset = 0

  for (const f of files) {
    const data = enc.encode(f.text)
    const name = enc.encode(f.name)
    const crc = crc32(data)

    const local = record(30, (v) => {
      v.setUint32(0, 0x04034b50, true) // local file header signature
      v.setUint16(4, 20, true) // version needed
      v.setUint16(6, 0, true) // general-purpose flags
      v.setUint16(8, 0, true) // method 0 = store
      v.setUint16(10, DOS_TIME, true)
      v.setUint16(12, DOS_DATE, true)
      v.setUint32(14, crc, true)
      v.setUint32(18, data.length, true) // compressed size
      v.setUint32(22, data.length, true) // uncompressed size
      v.setUint16(26, name.length, true)
      v.setUint16(28, 0, true) // extra-field length
    })
    body.push(local, name, data)

    central.push(
      record(46, (v) => {
        v.setUint32(0, 0x02014b50, true) // central directory header signature
        v.setUint16(4, 20, true) // version made by
        v.setUint16(6, 20, true) // version needed
        v.setUint16(8, 0, true) // flags
        v.setUint16(10, 0, true) // method
        v.setUint16(12, DOS_TIME, true)
        v.setUint16(14, DOS_DATE, true)
        v.setUint32(16, crc, true)
        v.setUint32(20, data.length, true)
        v.setUint32(24, data.length, true)
        v.setUint16(28, name.length, true)
        v.setUint16(30, 0, true) // extra
        v.setUint16(32, 0, true) // comment
        v.setUint16(34, 0, true) // disk number start
        v.setUint16(36, 0, true) // internal attrs
        v.setUint32(38, 0, true) // external attrs
        v.setUint32(42, offset, true) // relative offset of local header
      }),
      name,
    )
    offset += local.length + name.length + data.length
  }

  const cdSize = central.reduce((n, a) => n + a.length, 0)
  const eocd = record(22, (v) => {
    v.setUint32(0, 0x06054b50, true) // end-of-central-directory signature
    v.setUint16(4, 0, true) // disk number
    v.setUint16(6, 0, true) // disk with central dir
    v.setUint16(8, files.length, true) // entries on this disk
    v.setUint16(10, files.length, true) // total entries
    v.setUint32(12, cdSize, true) // central-dir size
    v.setUint32(16, offset, true) // central-dir offset
    v.setUint16(20, 0, true) // comment length
  })

  return new Blob(/** @type {BlobPart[]} */ ([...body, ...central, eocd]), { type: 'application/zip' })
}
