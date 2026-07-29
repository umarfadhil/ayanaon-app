const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');

function readPublicFile(relativePath) {
    return fs.readFileSync(path.join(publicDir, relativePath), 'utf8');
}

function readPngDimensions(relativePath) {
    const png = fs.readFileSync(path.join(publicDir, relativePath));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    return {
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20)
    };
}

test('manifest has a stable install identity and required icons', () => {
    const manifest = JSON.parse(readPublicFile('manifest.webmanifest'));
    assert.equal(manifest.name, 'AyaNaon?');
    assert.equal(manifest.short_name, 'AyaNaon');
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.lang, 'id');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.prefer_related_applications, false);

    const icon192 = manifest.icons.find((icon) => icon.sizes === '192x192');
    const icon512 = manifest.icons.find((icon) => icon.sizes === '512x512');
    assert.equal(icon192?.src, '/icon-192-v2.png');
    assert.equal(icon512?.src, '/icon-512-v2.png');
    assert.deepEqual(readPngDimensions('icon-192-v2.png'), { width: 192, height: 192 });
    assert.deepEqual(readPngDimensions('icon-512-v2.png'), { width: 512, height: 512 });
});

test('service worker precache is complete and updates only on user approval', () => {
    const packageVersion = require('../package.json').version;
    const source = readPublicFile('service-worker.js');
    assert.match(source, new RegExp(`CACHE_NAME = 'ayanaon-static-v${packageVersion.replaceAll('.', '\\.')}[^']*'`));

    const precacheSource = source.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/)?.[1];
    assert.ok(precacheSource, 'PRECACHE_URLS must be declared');
    const precacheUrls = [...precacheSource.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    assert.ok(precacheUrls.includes('/'));
    for (const url of precacheUrls) {
        const assetPath = url === '/' ? 'index.html' : url.replace(/^\//, '');
        assert.ok(fs.existsSync(path.join(publicDir, assetPath)), `Missing precache asset: ${url}`);
    }

    const installHandler = source.match(/self\.addEventListener\('install'[\s\S]*?\n\}\);/)?.[0];
    assert.ok(installHandler, 'install handler must exist');
    assert.doesNotMatch(installHandler, /skipWaiting/);
    assert.match(source, /event\.data\.type === 'SKIP_WAITING'/);
    assert.match(source, /caches\.match\('\/'\)/);
});

test('homepage metadata and staging crawler controls remain migration-safe', () => {
    const homepage = readPublicFile('index.html');
    assert.match(homepage, /<html lang="id">/);
    assert.match(homepage, /rel="canonical" href="https:\/\/www\.ayanaon\.app\/"/);
    assert.match(homepage, /property="og:image" content="https:\/\/www\.ayanaon\.app\/icon-512-v2\.png"/);
    assert.match(homepage, /rel="manifest" href="\/manifest\.webmanifest"/);

    const headers = readPublicFile('_headers');
    assert.match(headers, /\/service-worker\.js\s+Cache-Control: no-cache/);
    assert.match(headers, /https:\/\/ayanaon\.petalytix-id\.workers\.dev\/\*\s+X-Robots-Tag: noindex, nofollow/);
});
