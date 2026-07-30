const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');

process.env.GOOGLE_MAPS_BROWSER_API_KEY = 'browser-test-key';
delete process.env.MONGODB_URI;

const apiModule = require('../netlify/functions/api.js');

let server;
let origin;

before(async () => {
    await new Promise((resolve, reject) => {
        server = apiModule.app.listen(0, '127.0.0.1', resolve);
        server.once('error', reject);
    });
    const address = server.address();
    origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
    if (!server) return;
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

test('exports the shared Express app and Netlify handler', () => {
    assert.equal(typeof apiModule.app?.listen, 'function');
    assert.equal(typeof apiModule.handler, 'function');
    assert.equal(typeof apiModule.runWithDatabaseRequestContext, 'function');
    assert.equal(typeof apiModule.isNonProductionHostname, 'function');
});

test('falls back from empty Wrangler Google bindings to the legacy key', () => {
    assert.equal(apiModule.resolveGoogleApiKey('', 'legacy-test-key'), 'legacy-test-key');
    assert.equal(apiModule.resolveGoogleApiKey('specific-test-key', 'legacy-test-key'), 'specific-test-key');
});

test('local Wrangler dev loads the legacy Google key without weakening production requirements', () => {
    const wrangler = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../wrangler.jsonc'), 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    const productionSecrets = wrangler.secrets.required;
    const localSecrets = wrangler.env.local.secrets.required;

    assert.equal(productionSecrets.includes('GOOGLE_MAPS_API_KEY'), false);
    assert.equal(productionSecrets.includes('GOOGLE_MAPS_BROWSER_API_KEY'), true);
    assert.equal(productionSecrets.includes('GOOGLE_GEOCODING_API_KEY'), true);
    assert.equal(localSecrets.includes('GOOGLE_MAPS_API_KEY'), true);
    assert.equal(localSecrets.includes('GOOGLE_MAPS_BROWSER_API_KEY'), true);
    assert.equal(localSecrets.includes('GOOGLE_GEOCODING_API_KEY'), true);
    assert.equal(packageJson.scripts.dev, 'wrangler dev --env local');
    assert.equal(packageJson.scripts['dev:cloudflare'], 'wrangler dev --env local');
    assert.equal(packageJson.scripts['deploy:cloudflare'], 'wrangler deploy --env=""');
    assert.equal(packageJson.scripts['check:cloudflare'], 'wrangler deploy --env="" --dry-run --outdir .wrangler-dist');
});



function requestWithHost(host) {
    const address = server.address();
    return new Promise((resolve, reject) => {
        const request = http.request({
            hostname: '127.0.0.1',
            port: address.port,
            path: '/api/config',
            headers: { host }
        }, (response) => {
            response.resume();
            response.once('end', () => resolve(response));
        });
        request.once('error', reject);
        request.end();
    });
}

test('marks workers.dev responses as non-indexable', async () => {
    const response = await requestWithHost('ayanaon.petalytix-id.workers.dev');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
});

test('marks the custom staging hostname as non-indexable', async () => {
    const response = await requestWithHost('staging.ayanaon.app');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
});

test('does not mark the production hostname as non-indexable', async () => {
    const response = await requestWithHost('www.ayanaon.app');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-robots-tag'], undefined);
});

test('returns the browser-specific Google Maps key', async () => {
    const response = await fetch(`${origin}/api/config`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { googleMapsApiKey: 'browser-test-key' });
});

test('prefers Cloudflare client IP over Netlify client IP', async () => {
    const response = await fetch(`${origin}/api/ip`, {
        headers: {
            'cf-connecting-ip': '203.0.113.20',
            'x-nf-client-connection-ip': '198.51.100.10'
        }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ip: '203.0.113.20' });
});

test('retains Netlify client IP fallback', async () => {
    const response = await fetch(`${origin}/api/ip`, {
        headers: { 'x-nf-client-connection-ip': '198.51.100.10' }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ip: '198.51.100.10' });
});
