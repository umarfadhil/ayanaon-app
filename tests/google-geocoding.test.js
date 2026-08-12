const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

delete process.env.MONGODB_URI;
const { geocodeAddressWithGoogle } = require('../netlify/functions/api.js');

test('geocodes an address with the server-only Google key', async () => {
    let request;
    const httpClient = {
        async get(url, options) {
            request = { url, options };
            return {
                data: {
                    status: 'OK',
                    results: [{
                        formatted_address: 'Jakarta, Indonesia',
                        place_id: 'test-place',
                        geometry: { location: { lat: -6.2, lng: 106.816666 } }
                    }]
                }
            };
        }
    };

    const result = await geocodeAddressWithGoogle('Jakarta', {
        apiKey: 'server-test-key',
        httpClient
    });

    assert.deepEqual(result, {
        lat: -6.2,
        lng: 106.816666,
        formattedAddress: 'Jakarta, Indonesia',
        placeId: 'test-place'
    });
    assert.equal(request.url, 'https://maps.googleapis.com/maps/api/geocode/json');
    assert.equal(request.options.params.key, 'server-test-key');
    assert.equal(request.options.params.region, 'id');
    assert.equal(request.options.params.language, 'id');
});

test('returns a safe not-found error for zero results', async () => {
    const httpClient = {
        async get() {
            return { data: { status: 'ZERO_RESULTS', results: [] } };
        }
    };

    await assert.rejects(
        geocodeAddressWithGoogle('not-a-real-place', { apiKey: 'server-test-key', httpClient }),
        (error) => error.statusCode === 404 && error.code === 'ZERO_RESULTS'
    );
});

test('explains when the server key incorrectly uses website referrer restrictions', async () => {
    const httpClient = {
        async get() {
            return {
                data: {
                    status: 'REQUEST_DENIED',
                    error_message: 'API keys with referer restrictions cannot be used with this API.',
                    results: []
                }
            };
        }
    };

    await assert.rejects(
        geocodeAddressWithGoogle('Jakarta', { apiKey: 'server-test-key', httpClient }),
        (error) => error.statusCode === 503
            && error.code === 'REQUEST_DENIED'
            && /pembatasan Website\/referrer/.test(error.message)
            && /Geocoding API/.test(error.message)
    );
});

test('requires a configured server geocoding key', async () => {
    await assert.rejects(
        geocodeAddressWithGoogle('Jakarta', { apiKey: '' }),
        (error) => error.statusCode === 503 && error.code === 'NOT_CONFIGURED'
    );
});
test('admin location searches use the authenticated server geocoding endpoint', () => {
    const adminSource = fs.readFileSync(path.resolve(__dirname, '../public/admin-gather.js'), 'utf8');

    assert.match(adminSource, /\/api\/admin\/gather\/geocode\?query=/);
    assert.match(adminSource, /Authorization: `Bearer \$\{getToken\(\)\}`/);
    assert.doesNotMatch(adminSource, /new\s+gmaps\.Geocoder\s*\(/);
});
