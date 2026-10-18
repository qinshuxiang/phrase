import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const rootUrl = new URL('../', import.meta.url);
const root = fileURLToPath(rootUrl);
const releaseDate = process.env.RELEASE_DATE || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()).replaceAll('-', '');
assert.match(releaseDate, /^\d{8}$/);
const archive = fileURLToPath(new URL(`../phrase-vue-xingce-${releaseDate}.zip`, rootUrl));
const excluded = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.DS_Store']);
const files = [];
async function walk(relative = '') {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
        const name = join(relative, entry.name);
        if (excluded.has(entry.name) || name === 'research/cache' || entry.name.endsWith('.local') || name === 'SHA256SUMS') continue;
        if (entry.isDirectory()) await walk(name); else if (entry.isFile()) files.push(name);
    }
}
await walk(); files.sort();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sums = [];
for (const file of files) sums.push(`${sha(await readFile(join(root, file)))}  ${file}`);
await writeFile(join(root, 'SHA256SUMS'), sums.join('\n') + '\n');
files.push('SHA256SUMS'); files.sort();
const temp = await mkdtemp(join(tmpdir(), 'xingce-package-'));
try {
    const manifest = join(temp, 'files.json'); await writeFile(manifest, JSON.stringify(files));
    const program = `import json, pathlib, sys, zipfile\nroot=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2]); files=json.loads(pathlib.Path(sys.argv[3]).read_text())\nwith zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:\n for f in files: z.write(root/f,'phrase-vue/'+f)\nwith zipfile.ZipFile(output) as z:\n assert z.testzip() is None\n assert len(z.namelist())==len(files)\n for f in files: assert z.read('phrase-vue/'+f)==(root/f).read_bytes(), f\n`;
    execFileSync('python3', ['-c', program, root, archive, manifest], { stdio: 'inherit' });
    const sha256 = sha(await readFile(archive));
    await writeFile(`${archive}.sha256`, `${sha256}  ${archive.split('/').at(-1)}\n`);
    const report = { passed: true, archive, bytes: (await stat(archive)).size, sha256, files: files.length,
        byte_comparison: 'all archive files compared with workspace', excludes: [...excluded, 'research/cache', '*.local'],
        sha256sums_entries: sums.length };
    await writeFile(`${archive}.manifest.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
