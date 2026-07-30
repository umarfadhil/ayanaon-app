const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

delete process.env.MONGODB_URI;
const { isGatherPublishedDuplicate } = require('../netlify/functions/api.js');

test('matches a manually published pin by normalized title and nearby coordinates', () => {
    const draft = {
        source: 'pertamina',
        externalId: 'station-123',
        title: 'SPBU COCO Jakarta Samanhudi',
        link: 'https://pertaminaretail.com/outlet-locator',
        lat: -6.1647,
        lng: 106.8325
    };
    const publishedPin = {
        title: 'SPBU COCO Jakarta Samanhudi',
        link: 'https://example.com/manual-pin',
        lat: -6.1649,
        lng: 106.8327
    };
    assert.equal(isGatherPublishedDuplicate(draft, publishedPin), true);
});

test('does not treat different locator entries as duplicates only because they share a link', () => {
    const draft = {
        source: 'pertamina',
        externalId: 'station-123',
        title: 'SPBU COCO Jakarta Samanhudi',
        link: 'https://pertaminaretail.com/outlet-locator',
        lat: -6.1647,
        lng: 106.8325
    };
    const otherStation = {
        title: 'SPBU COCO Jakarta Cikini',
        link: 'https://pertaminaretail.com/outlet-locator',
        lat: -6.194,
        lng: 106.839
    };
    assert.equal(isGatherPublishedDuplicate(draft, otherStation), false);
});

test('still matches Gather provenance IDs and canonical event links', () => {
    assert.equal(isGatherPublishedDuplicate(
        { source: 'tiket', externalId: 'event-1', title: 'Changed title' },
        { gatheredFrom: { source: 'tiket', externalId: 'event-1' }, title: 'Old title' }
    ), true);
    assert.equal(isGatherPublishedDuplicate(
        { source: 'tiket', externalId: 'event-2', title: 'Music Night', link: 'https://example.com/event?utm_source=tiket' },
        { title: 'music night', link: 'https://example.com/event/' }
    ), true);
});

test('Gather UI exposes a safe open-in-new-tab link control', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/admin.html'), 'utf8');
    const script = fs.readFileSync(path.resolve(__dirname, '../public/admin-gather.js'), 'utf8');
    assert.match(html, /id="gather-open-link"[^>]+target="_blank"[^>]+rel="noopener noreferrer"/);
    assert.match(script, /function updateOpenLink/);
    assert.match(script, /\['http:', 'https:'\]\.includes\(parsed\.protocol\)/);
});

test('a missing browser Maps key degrades only the location preview', () => {
    const script = fs.readFileSync(path.resolve(__dirname, '../public/admin-gather.js'), 'utf8');
    assert.match(script, /gatherLocationMap\.classList\.add\('is-unavailable'\)/);
    assert.match(script, /gatherLocationMap\.textContent = error\.message/);
    assert.doesNotMatch(script, /catch \(error\) \{\s*showMessage\('error', error\.message\);\s*\}\s*\}\s*\n\s*async function searchLocation/);
});


test('browser scrapers follow current tiket and KalenderLari page contracts', () => {
    const actor = fs.readFileSync(path.resolve(__dirname, '../gather-actor/src/main.js'), 'utf8');
    assert.match(actor, /a\[href\*='\/to-do\/'\]/);
    assert.match(actor, /www\.tiket\.com\/en-id\/to-do\/search/);
    assert.match(actor, /Tiket search returned no event cards/);
    assert.match(actor, /script\[type='application\/ld\+json'\]/);
    assert.match(actor, /a\[href\*='\/events\/'\]/);
    assert.doesNotMatch(actor, /a\[href\*='\/event\/'\]/);
});

test('Tiket details produce the localized summary and full venue address', async () => {
    const utilsUrl = pathToFileURL(path.resolve(__dirname, '../gather-actor/src/tiket-utils.js')).href;
    const { buildTiketDescription, cleanTiketLocation, normalizeTiketPrice } = await import(utilsUrl);
    const location = cleanTiketLocation(
        'Indonesia Arena, Jalan Pintu Satu Senayan, RT.1/RW.3, Gelora, Central Jakarta City, Jakarta, Indonesia, Central Jakarta\nIndonesia'
    );
    const price = normalizeTiketPrice('Ticket prices start from IDR 986,000');

    assert.equal(location, 'Indonesia Arena, Jalan Pintu Satu Senayan, RT.1/RW.3, Gelora, Central Jakarta City, Jakarta, Indonesia');
    assert.equal(price, 'IDR 986,000');
    assert.equal(
        buildTiketDescription({ price, location, startDate: '2026-10-29' }),
        '\u{1F4B2} Mulai dari IDR 986,000\n'
        + '\u{1F4CD} Indonesia Arena, Jalan Pintu Satu Senayan, RT.1/RW.3, Gelora, Central Jakarta City, Jakarta, Indonesia\n\n'
        + '\u{1F4C5} Kamis, 29 Oktober 2026'
    );

    const actor = fs.readFileSync(path.resolve(__dirname, '../gather-actor/src/main.js'), 'utf8');
    assert.match(actor, /ATFSection_info_label/);
    assert.match(actor, /waitForFunction/);
});

test('Gather Actor deployment metadata identifies the repaired browser build', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../gather-actor/.actor/actor.json'), 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../gather-actor/package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../gather-actor/package-lock.json'), 'utf8'));
    const actorIgnore = fs.readFileSync(path.resolve(__dirname, '../gather-actor/.actorignore'), 'utf8');

    assert.equal(manifest.version, '1.2');
    assert.equal(manifest.buildTag, 'latest');
    assert.equal(packageJson.version, '1.2.0');
    assert.equal(packageLock.version, '1.2.0');
    assert.equal(packageLock.packages[''].version, '1.2.0');
    assert.match(actorIgnore, /^node_modules\/$/m);
    assert.match(actorIgnore, /^storage\/$/m);
});
