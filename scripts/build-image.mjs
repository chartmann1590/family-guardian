#!/usr/bin/env node
// Cross-platform "one-shot" build:
//   1. Build the Android debug APK
//   2. Copy it into server/downloads/family-guardian.apk
//   3. docker compose build (the Dockerfile bakes downloads/ in)
//
// Run from the repo root:
//   node scripts/build-image.mjs

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ANDROID_DIR = join(ROOT, 'android');
const APK_SRC = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APK_DEST_DIR = join(ROOT, 'server', 'downloads');
const APK_DEST = join(APK_DEST_DIR, 'family-guardian.apk');
const isWin = process.platform === 'win32';

function step(label) { console.log(`\n=== ${label} ===`); }

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...opts });
    if (r.status !== 0) {
        console.error(`\n[build-image] FAIL: ${cmd} ${args.join(' ')} exited ${r.status}`);
        process.exit(r.status || 1);
    }
}

step('1. Building Android debug APK');
const gradlew = isWin ? join(ANDROID_DIR, 'gradlew.bat') : './gradlew';
run(gradlew, ['assembleDebug'], { cwd: ANDROID_DIR });

if (!existsSync(APK_SRC)) {
    console.error(`[build-image] APK not produced at ${APK_SRC}`);
    process.exit(1);
}

step('2. Copying APK into server build context');
mkdirSync(APK_DEST_DIR, { recursive: true });
copyFileSync(APK_SRC, APK_DEST);
const apkSize = statSync(APK_DEST).size;
console.log(`   ${APK_DEST} (${(apkSize / (1024 * 1024)).toFixed(1)} MB)`);

step('3. docker compose build');
run('docker', ['compose', 'build'], { cwd: ROOT });

console.log('\n[build-image] Done. To boot:');
console.log('   docker compose up -d');
