const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

delete process.env.MONGODB_URI;
const {
    computeExpiresAtFromLifetime,
    enrichGatherDraftCoordinates,
    hasGatherMaterialChanges,
    isGatherPublishedDuplicate,
    needsKalenderLariRefresh,
    needsSpkluDescriptionRefresh,
    normalizeGatherDraft
} = require('../netlify/functions/api.js');

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

test('Gather dates are optional and supportive images stay compact', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/admin.html'), 'utf8');
    const script = fs.readFileSync(path.resolve(__dirname, '../public/admin-gather.js'), 'utf8');
    const css = fs.readFileSync(path.resolve(__dirname, '../public/admin.css'), 'utf8');
    const api = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/api.js'), 'utf8');

    assert.match(html, /Start Date \(optional\)/);
    assert.match(html, /End Date \(optional\)/);
    assert.doesNotMatch(html, /id="gather-(?:start|end)-date"[^>]*required/);
    assert.match(script, /\['title', 'description', 'category', 'link'\]\.forEach/);
    assert.match(script, /missing\.push\('dateRange'\)/);
    assert.match(script, /5\/5 field wajib siap dipublikasikan/);
    assert.match(api, /\['dateRange', !hasInvalidDateRange\]/);
    assert.match(api, /const lifetime = normalized\.startDate \|\| normalized\.endDate/);
    assert.match(api, /: null;\s*const pinFields =/);
    assert.match(css, /#gather-image-list\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*flex-start;/s);

    const permanentDraft = normalizeGatherDraft({
        source: 'spklu', title: 'SPKLU Senayan', description: 'Lokasi pengisian kendaraan listrik',
        category: 'SPKLU', link: 'https://example.com/spklu', lat: -6.21, lng: 106.8,
        startDate: '', endDate: ''
    }, 'spklu');
    assert.deepEqual(permanentDraft.missingFields, []);
    assert.equal(computeExpiresAtFromLifetime(null), null);

    const reversedDates = normalizeGatherDraft({
        ...permanentDraft, startDate: '2026-08-13', endDate: '2026-08-12'
    }, 'spklu');
    assert.deepEqual(reversedDates.missingFields, ['dateRange']);
});

test('SPKLU descriptions derive charger totals from charger boxes and expose each box', async () => {
    const utilsUrl = pathToFileURL(path.resolve(__dirname, '../gather-actor/src/spklu-utils.js')).href;
    const { buildSpkluDescription } = await import(utilsUrl);
    const oldDescription = '⚡ Daya Max: 50 kW\n🔌 Total Charger: -';
    const description = buildSpkluDescription({
        watt: '50 kW',
        total_charger: 0,
        chargerboxes: [
            { type_charge: 'fast', watt: '50 kW', jumlah_charger: 4 },
            { type_charge: 'fast', watt: '50 kW', jumlah_charger: 4 },
            { type_charge: 'medium', watt: '25 kW', jumlah_charger: 4 },
            { type_charge: 'fast', watt: '50 kW', jumlah_charger: 4 }
        ]
    });

    assert.equal(description,
        '⚡ Daya Max: 50 kW\n'
        + '🔌 Total Charger: 16\n'
        + '⛽ Charger Box Tersedia:\n'
        + '- Fast | 50 kW | 4\n'
        + '- Fast | 50 kW | 4\n'
        + '- Medium | 25 kW | 4\n'
        + '- Fast | 50 kW | 4');
    assert.equal(needsSpkluDescriptionRefresh(oldDescription), true);
    assert.equal(needsSpkluDescriptionRefresh(description), false);

    const api = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/api.js'), 'utf8');
    assert.match(api, /if \(source !== 'spklu'\) pins\.forEach/);
    assert.match(api, /if \(source === 'spklu'\)[\s\S]+draft\.status === 'draft'/);
    assert.match(api, /updateTargetPinId: publishedPin\._id/);
    assert.match(api, /updateDraftCount \+= 1/);
});

test('SPBU COCO keeps its multiline Pertamina description format', async () => {
    const utilsUrl = pathToFileURL(path.resolve(__dirname, '../gather-actor/src/pertamina-utils.js')).href;
    const { buildPertaminaDescription } = await import(utilsUrl);
    const description = buildPertaminaDescription({
        operational_hour: '24 jam',
        fuel: 'Pertamax, Pertamax Green, Pertamax Turbo, Pertalite, Pertamina Dex, Dexlite',
        facility: ['Toilet', 'Musholla']
    });

    assert.equal(description,
        '🕓 Jam Operasional : 24 jam\n\n'
        + '🛢️ Bahan Bakar :\n'
        + 'Pertamax\n'
        + 'Pertamax Green\n'
        + 'Pertamax Turbo\n'
        + 'Pertalite\n'
        + 'Pertamina Dex\n'
        + 'Dexlite\n\n'
        + '🏪 Fasilitas :\n'
        + 'Toilet\n'
        + 'Musholla');

    const legacyDraft = normalizeGatherDraft({
        source: 'pertamina',
        title: 'SPBU COCO Jakarta Samanhudi',
        description: '🕓 Jam Operasional: 24 jam\n\n'
            + '⛽ Bahan Bakar:\n'
            + 'Pertamax, Pertamax Green, Pertamax Turbo, Pertalite, Pertamina Dex, Dexlite\n\n'
            + '🏪 Fasilitas:\n'
            + 'Toilet, Musholla',
        category: '⛽ SPBU',
        link: 'https://pertaminaretail.com/outlet-locator',
        lat: -6.1647,
        lng: 106.8325
    }, 'pertamina');
    assert.equal(legacyDraft.description, description);
    assert.equal(legacyDraft.category, '⛽ SPBU/SPBG');

    const publishedSamanhudi = {
        title: 'SPBU COCO  Jakarta Samanhudi',
        description: '🕓 Jam Operasional : 24 jam\n\n'
            + '🛢️ Bahan Bakar : \n'
            + 'Pertamax\nPertamax Green\nPertamax Turbo\nPertalite\nPertamina Dex\nDexlite\n\n'
            + '🏪 Fasilitas : \nToilet\nMusholla',
        category: '⛽ SPBU/SPBG',
        link: 'https://pertaminaretail.com/outlet-locator',
        lat: -6.160345674123131,
        lng: 106.83522076214601
    };
    const scrapedSamanhudi = normalizeGatherDraft({
        source: 'pertamina',
        externalId: '31.107.02',
        title: 'SPBU COCO Jakarta Samanhudi',
        description: '🕓 Jam Operasional: 24 jam\n\n'
            + '⛽ Bahan Bakar:\nPertamax, Pertamax Green, Pertamax Turbo, Pertalite, Pertamina Dex, Dexlite\n\n'
            + '🏪 Fasilitas:\nToilet, Musholla',
        category: '⛽ SPBU',
        link: 'https://pertaminaretail.com/outlet-locator',
        lat: -6.160345674123131,
        lng: 106.83522076214601
    }, 'pertamina');
    assert.equal(hasGatherMaterialChanges(scrapedSamanhudi, publishedSamanhudi), false);

    const otherSourceDescription = '🕓 Jam Operasional: 24 jam\n⛽ Bahan Bakar: Pertamax, Pertalite';
    assert.equal(normalizeGatherDraft({
        ...legacyDraft,
        source: 'spklu',
        description: otherSourceDescription
    }, 'spklu').description, otherSourceDescription);

    const api = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/api.js'), 'utf8');
    const actor = fs.readFileSync(path.resolve(__dirname, '../gather-actor/src/main.js'), 'utf8');
    assert.match(api, /id: 'pertamina', label: 'SPBU COCO'/);
    assert.match(api, /category: '⛽ SPBU\/SPBG'/);
    assert.doesNotMatch(api, /label: 'Pertamina Outlet'/);
    assert.match(actor, /spbu: '⛽ SPBU\/SPBG'/);
    assert.match(api, /!hasGatherMaterialChanges\(normalizeGatherDraft\(draft, draft\.source\), publishedPin\)/);
});

test('changed published SPKLU pins become update drafts instead of duplicates', () => {
    const gathered = {
        source: 'spklu', externalId: '1', title: 'SPKLU PLN UID JAKARTA RAYA',
        description: '⚡ Daya Max: 22 kW\n🔌 Total Charger: 1\n⛽ Charger Box Tersedia:\n- Medium | 22 kW | 1',
        category: '⚡ SPKLU', link: 'https://petaspklu.id/', lat: -6.18039, lng: 106.833191
    };
    const published = {
        title: 'SPKLU PLN UID JAKARTA RAYA',
        description: '⚡Daya Max : 200 kW\n🔌Total Charger : 4',
        category: '⚡ SPKLU', link: 'https://petaspklu.id/', lat: -6.18039, lng: 106.833191
    };
    assert.equal(isGatherPublishedDuplicate(gathered, published), true);
    assert.equal(hasGatherMaterialChanges(gathered, published), true);
    assert.equal(hasGatherMaterialChanges(gathered, { ...published, description: gathered.description }), false);

    const actor = fs.readFileSync(path.resolve(__dirname, '../gather-actor/src/main.js'), 'utf8');
    const api = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/api.js'), 'utf8');
    const admin = fs.readFileSync(path.resolve(__dirname, '../public/admin-gather.js'), 'utf8');
    assert.match(actor, /typeof value === 'number' && Number\.isFinite\(value\).*String\(value\)/s);
    assert.match(api, /updateTargetPinId: publishedPin\._id/);
    assert.match(api, /if \(updateTarget\)[\s\S]+collection\('pins'\)\.updateOne/);
    assert.match(api, /!hasGatherMaterialChanges\(normalizeGatherDraft\(draft, draft\.source\), publishedPin\)/);
    assert.match(admin, /isUpdate \? 'Siap update pin'/);
    assert.match(admin, /result\.updated \? 'Pin lama berhasil diperbarui\.'/);
});


test('browser scrapers follow current tiket and KalenderLari page contracts', () => {
    const actor = fs.readFileSync(path.resolve(__dirname, '../gather-actor/src/main.js'), 'utf8');
    assert.match(actor, /a\[href\*='\/to-do\/'\]/);
    assert.match(actor, /www\.tiket\.com\/en-id\/to-do\/search/);
    assert.match(actor, /Tiket search returned no event cards/);
    assert.match(actor, /script\[type='application\/ld\+json'\]/);
    assert.match(actor, /a\[href\*='\/events\/'\]/);
    assert.doesNotMatch(actor, /a\[href\*='\/event\/'\]/);
    assert.match(actor, /\.mec-more-info-button\[href\], \.mec-booking-button\[href\]/);
    assert.match(actor, /link: data\.originalLink \|\| request\.url/);
    assert.match(actor, /sourceMeta: \{ location: data\.location, kalenderLariLink: request\.url \}/);
});

test('Yesplis uses the current v5 API and persists actionable Actor failures', () => {
    const actor = fs.readFileSync(path.resolve(__dirname, '../gather-actor/src/main.js'), 'utf8');

    assert.match(actor, /const YESPLIS_API_BASE = 'https:\/\/api-v5\.yesplis\.com'/);
    assert.doesNotMatch(actor, /api-v4\.yesplis\.com/);
    assert.match(actor, /Actor\.setStatusMessage\(statusMessage, \{ isStatusMessageTerminal: true, level: 'ERROR' \}\)/);
    assert.match(actor, /tidak ditemukan \(DNS\)/);
});

test('KalenderLari prefers the original registration link and repairs missing venue coordinates', async () => {
    const raw = normalizeGatherDraft({
        source: 'kalenderlari',
        externalId: 'titan-run-2026',
        title: 'TITAN Run 2026',
        description: 'Race at ICE BSD',
        category: '🏃 Olahraga & Aktivitas Hobi',
        link: 'https://www.titan.run/',
        startDate: '2026-08-15',
        endDate: '2026-08-15',
        lat: null,
        lng: null,
        sourceMeta: {
            location: 'Indonesia Convention Exhibition (ICE) BSD',
            kalenderLariLink: 'https://kalenderlari.com/events/titan-run-2026/'
        }
    }, 'kalenderlari');

    assert.equal(raw.lat, null);
    assert.equal(raw.lng, null);
    assert.deepEqual(raw.missingFields, ['coordinates']);

    let query = '';
    const enriched = await enrichGatherDraftCoordinates(raw, 'kalenderlari', async (location) => {
        query = location;
        return {
            lat: -6.300258,
            lng: 106.636604,
            formattedAddress: 'ICE BSD, Kabupaten Tangerang, Banten',
            placeId: 'ice-bsd-test'
        };
    });

    assert.equal(query, 'Indonesia Convention Exhibition (ICE) BSD');
    assert.equal(enriched.lat, -6.300258);
    assert.equal(enriched.lng, 106.636604);
    assert.deepEqual(enriched.missingFields, []);
    assert.equal(enriched.link, 'https://www.titan.run/');
    assert.equal(enriched.sourceMeta.kalenderLariLink, 'https://kalenderlari.com/events/titan-run-2026/');
    assert.equal(needsKalenderLariRefresh({ link: 'https://kalenderlari.com/events/titan-run-2026/', lat: 0, lng: 0 }), true);
    assert.equal(needsKalenderLariRefresh(enriched), false);

    const api = fs.readFileSync(path.resolve(__dirname, '../netlify/functions/api.js'), 'utf8');
    const admin = fs.readFileSync(path.resolve(__dirname, '../public/admin-gather.js'), 'utf8');
    assert.match(api, /await Promise\.all\(items\.map\(\(item\) => enrichGatherDraftCoordinates/);
    assert.match(api, /source === 'kalenderlari' && needsKalenderLariRefresh\(draft\)/);
    assert.match(api, /refresh\.link = normalized\.link/);
    assert.match(api, /refresh\.lat = normalized\.lat/);
    assert.match(admin, /value === null \|\| value === '' \|\| typeof value === 'undefined'/);
    assert.match(admin, /!\(lat === 0 && lng === 0\)/);
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

    assert.equal(manifest.version, '1.5');
    assert.equal(manifest.buildTag, 'latest');
    assert.equal(packageJson.version, '1.5.0');
    assert.equal(packageLock.version, '1.5.0');
    assert.equal(packageLock.packages[''].version, '1.5.0');
    assert.match(actorIgnore, /^node_modules\/$/m);
    assert.match(actorIgnore, /^storage\/$/m);
});
