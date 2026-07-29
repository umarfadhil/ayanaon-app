const assert = require('node:assert/strict');
const http = require('node:http');
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
    assert.equal(typeof apiModule.isWorkersDevHostname, 'function');
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
