const assert = require('node:assert/strict');
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
