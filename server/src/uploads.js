import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export async function streamToTemp(file, dir) {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.upload-${randomBytes(6).toString('hex')}.tmp`);
    try {
        await pipeline(file.file, createWriteStream(tmp));
    } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
    }
    return { tmpPath: tmp, truncated: !!file.file.truncated };
}

export async function commitAttachment({ tmpPath, finalPath, transform }) {
    const dir = dirname(finalPath);
    await mkdir(dir, { recursive: true });
    if (transform) {
        const { readFile, writeFile } = await import('node:fs/promises');
        let buf = await readFile(tmpPath);
        buf = await transform(buf);
        await writeFile(finalPath, buf);
        await unlink(tmpPath).catch(() => {});
    } else {
        await rename(tmpPath, finalPath);
    }
}
