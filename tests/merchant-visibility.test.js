const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.GOOGLE_MAPS_BROWSER_API_KEY = 'browser-test-key';
delete process.env.MONGODB_URI;

const {
    cleanMerchantMenuHighlights,
    cleanMerchantModifierGroups,
    buildMerchantPageHtml,
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

test('modifier group sanitizer drops empty/invalid groups and caps price adjustment', () => {
    const result = cleanMerchantModifierGroups([
        { name: 'Level Gula', values: [{ name: 'Normal', priceAdjustment: 0 }, { name: 'Less', priceAdjustment: '2000' }] },
        { name: 'Empty Group', values: [] },
        { name: '', values: [{ name: 'x' }] },
        { values: [{ name: 'y' }] }
    ]);

    assert.deepEqual(result.map((g) => g.name), ['Level Gula']);
    assert.deepEqual(result[0].values, [
        { name: 'Normal', priceAdjustment: 0 },
        { name: 'Less', priceAdjustment: 2000 }
    ]);
    // No selectionType sent → defaults to SINGLE/1/1, same as the AyaKasir
    // server-side normalizeSelection() default.
    assert.equal(result[0].selectionType, 'SINGLE');
    assert.equal(result[0].minSelect, 1);
    assert.equal(result[0].maxSelect, 1);
});

test('modifier group sanitizer clamps MULTI min/max to the value count (2026-08-29)', () => {
    const [tooWide] = cleanMerchantModifierGroups([
        {
            name: 'Topping',
            selectionType: 'MULTI',
            minSelect: 5,
            maxSelect: 99,
            values: [{ name: 'Bubble', priceAdjustment: 2000 }, { name: 'Mango Slice', priceAdjustment: 5000 }]
        }
    ]);
    assert.equal(tooWide.selectionType, 'MULTI');
    assert.equal(tooWide.maxSelect, 2); // clamped to values.length
    assert.equal(tooWide.minSelect, 2); // clamped down since it can't exceed maxSelect

    const [optional] = cleanMerchantModifierGroups([
        {
            name: 'Topping',
            selectionType: 'MULTI',
            minSelect: 0,
            maxSelect: 2,
            values: [{ name: 'Bubble' }, { name: 'Mango Slice' }]
        }
    ]);
    assert.equal(optional.minSelect, 0);
    assert.equal(optional.maxSelect, 2);

    const [garbage] = cleanMerchantModifierGroups([
        { name: 'Topping', selectionType: 'MULTI', minSelect: 'nope', maxSelect: null, values: [{ name: 'Bubble' }] }
    ]);
    assert.equal(garbage.minSelect, 0);
    assert.equal(garbage.maxSelect, 1);
});

test('menu highlights carry sanitized modifierGroups alongside variants', () => {
    const [item] = cleanMerchantMenuHighlights([
        {
            name: 'Es Kopi Susu',
            price: 15000,
            modifierGroups: [
                { name: 'Level Gula', values: [{ name: 'Normal' }, { name: 'Less' }] }
            ]
        }
    ]);

    assert.deepEqual(item.modifierGroups, [
        {
            name: 'Level Gula',
            selectionType: 'SINGLE',
            minSelect: 1,
            maxSelect: 1,
            values: [{ name: 'Normal', priceAdjustment: 0 }, { name: 'Less', priceAdjustment: 0 }]
        }
    ]);
});

test('/toko page renders a modifier picker only for items that have one', () => {
    const menuHighlights = cleanMerchantMenuHighlights([
        {
            name: 'Es Kopi Susu',
            price: 15000,
            modifierGroups: [{ name: 'Level Gula', values: [{ name: 'Normal' }, { name: 'Less' }] }]
        },
        { name: 'Air Mineral', price: 5000 }
    ]);
    const merchant = {
        name: 'Toko Uji', category: 'Kuliner', city: 'Bandung', province: 'Jawa Barat',
        whatsapp: '628123456789', lat: -6.9, lng: 107.6, orderUrl: null, logoUrl: null,
        menuLayout: 'LIST', photos: [], menuHighlights, openingHours: [], slug: 'toko-uji'
    };
    const html = buildMerchantPageHtml(merchant, {}, 'https://www.ayanaon.app');

    assert.ok(html.includes('data-modifiers='), 'modifier-bearing item should carry a data-modifiers attribute');
    assert.ok(html.includes('data-open-modifier'), 'modifier-bearing item should render the picker-opening button');
    assert.ok(html.includes('id="toko-modifier-modal"'), 'page should include the shared modifier picker modal');

    const airMineralNoModal = buildMerchantPageHtml(
        { ...merchant, menuHighlights: [{ name: 'Air Mineral', price: 5000, available: true, variants: [], modifierGroups: [] }] },
        {},
        'https://www.ayanaon.app'
    );
    assert.equal(airMineralNoModal.includes('id="toko-modifier-modal"'), false, 'stores with no modifier items should not ship the picker modal markup');
});
