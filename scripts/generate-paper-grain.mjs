// Deterministic monochrome pixel noise. Run with Node; no external dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const size = 256;
let seed = 120927;
const pixels = Buffer.alloc(size * (size + 1));
for (let y = 0; y < size; y++) {
    // PNG filter byte stays zero; each following byte is one grayscale pixel.
    for (let x = 0; x < size; x++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        pixels[y * (size + 1) + x + 1] = seed >>> 24;
    }
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8; // 8-bit grayscale, opaque; CSS controls the visual strength.
const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0))
]);
const assets = new URL('../assets/', import.meta.url);
mkdirSync(assets, { recursive: true });
writeFileSync(new URL('paper-grain.png', assets), png);
console.log(`Generated paper-grain.png: ${size} x ${size}, ${png.length} bytes`);
