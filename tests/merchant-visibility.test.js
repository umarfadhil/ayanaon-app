const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.GOOGLE_MAPS_BROWSER_API_KEY = 'browser-test-key';
delete process.env.MONGODB_URI;

const {
    cleanMerchantMenuHighlights,
    MERCHANT_STOREFRONT_CACHE_CONTROL
} = require('../netlify/functions/api.js');

test('partner menu sanitizer rejects explicitly hidden entries', () => {
    const result = cleanMerchantMenuHighlights([
        { name: 'Legacy visible', price: 10000 },
        { name: 'Visible', price: 12000, onlineVisible: true },
        { name: 'Hidden', price: 15000, onlineVisible: false }
    ]);

    assert.deepEqual(result.map((item) => item.name), ['Legacy visible', 'Visible']);
    assert.equal(result.some((item) => Object.hasOwn(item, 'onlineVisible')), false);
});

test('merchant storefront responses are not cached after a partner sync', () => {
    assert.equal(MERCHANT_STOREFRONT_CACHE_CONTROL, 'private, no-store, max-age=0');
});
