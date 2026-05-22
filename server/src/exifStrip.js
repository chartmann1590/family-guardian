const JPEG = 0xff;
const SOI = 0xd8;
const SOS = 0xda;
const APP1 = 0xe1;
const APP2 = 0xe2;

export function stripJpegExif(buf) {
    if (buf[0] !== JPEG || buf[1] !== SOI) return buf;
    const out = [Buffer.from([JPEG, SOI])];
    let offset = 2;
    while (offset < buf.length - 1) {
        if (buf[offset] !== JPEG) break;
        const marker = buf[offset + 1];
        if (marker === SOS) {
            out.push(buf.subarray(offset));
            break;
        }
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen < 2) break;
        if (marker !== APP1 && marker !== APP2) {
            out.push(buf.subarray(offset, offset + 2 + segLen));
        }
        offset += 2 + segLen;
    }
    return Buffer.concat(out);
}

export function stripImageMetadata({ buffer, mime }) {
    if (mime === 'image/jpeg') return stripJpegExif(buffer);
    return buffer;
}

const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_AUDIO = new Set(['audio/mp4', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/webm']);

export function isAllowedImageMime(mime) {
    return ALLOWED_IMAGE.has(mime);
}

export function isAllowedAudioMime(mime) {
    return ALLOWED_AUDIO.has(mime);
}
