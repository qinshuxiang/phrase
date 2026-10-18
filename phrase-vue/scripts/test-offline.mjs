import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('offline/行测学习-离线版.html', root);
const isolated = await mkdtemp(join(tmpdir(), 'phrase offline 中文 '));
const target = join(isolated, '行测学习 离线测试.html');
try {
    await copyFile(source, target);
    assert.deepEqual(await readdir(isolated), ['行测学习 离线测试.html']);
    const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('node_modules/@playwright/test/cli.js', root)),
            'test', '--config', 'playwright.offline.config.js'], {
            cwd: fileURLToPath(root), env: { ...process.env, OFFLINE_HTML: target }, stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('exit', resolve);
    });
    assert.equal(exitCode, 0, 'file://断网浏览器测试必须全部通过');
    await writeFile(new URL('evidence/offline-isolation.json', root), `${JSON.stringify({
        passed: true, file_only: true, protocol: 'file:', offline_before_first_navigation: true,
        isolated_filename: '行测学习 离线测试.html',
        sha256: createHash('sha256').update(await readFile(target)).digest('hex'),
    }, null, 4)}\n`);
} finally {
    await rm(isolated, { recursive: true, force: true });
}
