'use strict';

/**
 * scripts/audit-iconic-pins.js
 *
 * Audits and fixes coordinates for pins in the
 * "🏰 Tempat Ikonik & Bersejarah" category for target provinces.
 *
 * Usage:
 *   MONGODB_URI=<uri> node scripts/audit-iconic-pins.js [--dry-run]
 */

const { MongoClient } = require('mongodb');
const https = require('https');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'ayanaon-db';
const COLLECTION = 'pins';
const CATEGORY = '🏰 Tempat Ikonik & Bersejarah';
const DRY_RUN = process.argv.includes('--dry-run');
const THRESHOLD = 0.001; // degrees

const TARGET_PROVINCES = [
    // Batch 1
    'Aceh',
    'Sumatera Utara',
    'Riau',
    'Kepulauan Riau',
    'Jawa Barat',
    'DKI Jakarta',
    // Batch 2
    'Jambi',
    'Sumatera Selatan',
    'Kepulauan Bangka Belitung',
    'Bengkulu',
    'Lampung',
    'Banten',
];

// Special-case overrides: exact coordinates already confirmed correct
// These will always be applied regardless of Nominatim result.
const CONFIRMED_COORDS = {
    // Confirmed by task brief — only the short title key matches DB
    'Jembatan Gentala Arasy – Jembatan Pejalan Kaki Ikonik Jambi': { lat: -1.586463, lon: 103.615665 },
    // Nominatim returns the wrong Bung Karno exile house (in Ende, NTT).
    // The correct one in Bengkulu is at Jl. Soekarno-Hatta, Bengkulu city.
    'Rumah Pengasingan Bung Karno': { lat: -3.793500, lon: 102.262200 },
};

// Pins where Nominatim returns a clearly wrong result — keep existing coordinates.
const NOMINATIM_BLACKLIST = new Set([
    // Nominatim returns Jembatan 4 (wrong); Jembatan 1 (main) coords in DB are correct.
    'Jembatan Barelang',
    // Nominatim returns a temple in Ciamis, Jawa (completely wrong province).
    'Kelenteng Hok Tek Bio',
]);

// ---------------------------------------------------------------------------
// Nominatim lookup
// ---------------------------------------------------------------------------

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'AyaNaon-Audit/1.0 (https://ayanaon.app)',
                'Accept': 'application/json',
            },
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('JSON parse error: ' + e.message + '\nBody: ' + data.slice(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

async function nominatimLookup(title, city, province) {
    // Build progressively broader queries
    const queries = [
        `${title}, ${city}, ${province}, Indonesia`,
        `${title}, ${province}, Indonesia`,
        `${title}, Indonesia`,
    ];

    for (const q of queries) {
        const encoded = encodeURIComponent(q);
        const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&accept-language=id`;
        try {
            const results = await httpGet(url);
            if (Array.isArray(results) && results.length > 0) {
                const r = results[0];
                return {
                    lat: parseFloat(r.lat),
                    lon: parseFloat(r.lon),
                    display_name: r.display_name,
                    query: q,
                };
            }
        } catch (e) {
            console.error(`  Nominatim error for "${q}": ${e.message}`);
        }
        await sleep(1200); // respect rate limit (1 req/sec recommended)
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    if (!MONGODB_URI) {
        console.error('ERROR: MONGODB_URI environment variable is not set.');
        process.exit(1);
    }

    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const col = db.collection(COLLECTION);

    console.log(`Connected to MongoDB: ${DB_NAME}`);
    console.log(`DRY_RUN: ${DRY_RUN}`);
    console.log('');

    // Fetch all matching pins
    const pins = await col.find({
        category: CATEGORY,
        province: { $in: TARGET_PROVINCES },
    }).toArray();

    console.log(`Found ${pins.length} pins in target provinces.\n`);

    const results = [];

    for (let i = 0; i < pins.length; i++) {
        const pin = pins[i];
        const title = pin.title || pin.name || '(unnamed)';
        const province = pin.province || '';
        const city = pin.city || '';

        // Extract current coordinates
        // GeoJSON stores as [longitude, latitude]
        let oldLat, oldLon;
        if (pin.location && pin.location.coordinates && Array.isArray(pin.location.coordinates)) {
            oldLon = pin.location.coordinates[0];
            oldLat = pin.location.coordinates[1];
        } else if (pin.lat !== undefined && pin.lng !== undefined) {
            oldLat = pin.lat;
            oldLon = pin.lng;
        } else if (pin.lat !== undefined && pin.lon !== undefined) {
            oldLat = pin.lat;
            oldLon = pin.lon;
        } else {
            console.warn(`  [${i+1}/${pins.length}] "${title}" (${province}): No coordinates found, skipping.`);
            results.push({ title, province, oldLat: null, oldLon: null, newLat: null, newLon: null, updated: 'SKIP', diffLat: null, diffLon: null, reason: 'No coords' });
            continue;
        }

        process.stdout.write(`[${i+1}/${pins.length}] "${title}" (${province}) — checking... `);

        // Check blacklist — skip Nominatim for pins known to return wrong results
        if (NOMINATIM_BLACKLIST.has(title)) {
            console.log('BLACKLISTED (Nominatim known-wrong) — keeping existing coords');
            results.push({ title, province, oldLat, oldLon, newLat: oldLat, newLon: oldLon, updated: 'NO', diffLat: 0, diffLon: 0, reason: 'Nominatim blacklisted (known-wrong result)' });
            continue;
        }

        // Check for confirmed override
        let newLat, newLon, source;
        if (CONFIRMED_COORDS[title]) {
            newLat = CONFIRMED_COORDS[title].lat;
            newLon = CONFIRMED_COORDS[title].lon;
            source = 'CONFIRMED_OVERRIDE';
            console.log(`CONFIRMED OVERRIDE → lat=${newLat}, lon=${newLon}`);
        } else {
            await sleep(1200);
            const nom = await nominatimLookup(title, city, province);
            if (!nom) {
                console.log('NOT FOUND in Nominatim');
                results.push({ title, province, oldLat, oldLon, newLat: null, newLon: null, updated: 'NO', diffLat: null, diffLon: null, reason: 'Not found in Nominatim' });
                continue;
            }
            newLat = nom.lat;
            newLon = nom.lon;
            source = `Nominatim: "${nom.query}" → ${nom.display_name}`;
            console.log(`lat=${newLat.toFixed(6)}, lon=${newLon.toFixed(6)}`);
            console.log(`    Source: ${source}`);
        }

        const diffLat = Math.abs(newLat - oldLat);
        const diffLon = Math.abs(newLon - oldLon);
        const flagged = diffLat > THRESHOLD || diffLon > THRESHOLD;

        if (!flagged && !CONFIRMED_COORDS[title]) {
            results.push({ title, province, oldLat, oldLon, newLat, newLon, updated: 'NO', diffLat, diffLon, reason: 'Within threshold' });
            console.log(`    Diff: lat=${diffLat.toFixed(6)}, lon=${diffLon.toFixed(6)} — OK (within threshold)`);
            continue;
        }

        console.log(`    Diff: lat=${diffLat.toFixed(6)}, lon=${diffLon.toFixed(6)} — ${flagged ? 'FLAGGED' : 'CONFIRMED OVERRIDE'}`);

        if (DRY_RUN) {
            results.push({ title, province, oldLat, oldLon, newLat, newLon, updated: 'DRY_RUN', diffLat, diffLon, reason: flagged ? 'Exceeds threshold' : 'Confirmed override' });
            continue;
        }

        // Build update — update both GeoJSON and flat lat/lng fields
        const update = {
            $set: {
                'location.coordinates': [newLon, newLat],
            },
        };
        // Also update flat fields if they exist
        if (pin.lat !== undefined) update.$set.lat = newLat;
        if (pin.lng !== undefined) update.$set.lng = newLon;
        if (pin.lon !== undefined) update.$set.lon = newLon;

        try {
            await col.updateOne({ _id: pin._id }, update);
            console.log(`    Updated in DB.`);
            results.push({ title, province, oldLat, oldLon, newLat, newLon, updated: 'YES', diffLat, diffLon, reason: flagged ? 'Exceeds threshold' : 'Confirmed override' });
        } catch (e) {
            console.error(`    DB update error: ${e.message}`);
            results.push({ title, province, oldLat, oldLon, newLat, newLon, updated: 'ERROR', diffLat, diffLon, reason: e.message });
        }
    }

    await client.close();

    // ---------------------------------------------------------------------------
    // Print report table
    // ---------------------------------------------------------------------------
    console.log('\n');
    console.log('='.repeat(160));
    console.log('AUDIT REPORT — Tempat Ikonik & Bersejarah — Coordinate Audit');
    console.log('='.repeat(160));

    const header = [
        'Pin Name'.padEnd(40),
        'Province'.padEnd(28),
        'Old Lat'.padEnd(14),
        'Old Lon'.padEnd(14),
        'New Lat'.padEnd(14),
        'New Lon'.padEnd(14),
        'Updated'.padEnd(9),
        'Diff Lat'.padEnd(12),
        'Diff Lon'.padEnd(12),
        'Reason',
    ].join(' | ');
    console.log(header);
    console.log('-'.repeat(160));

    let updatedCount = 0;
    let skippedCount = 0;
    let noChangeCount = 0;

    for (const r of results) {
        const name = (r.title || '').slice(0, 39).padEnd(40);
        const prov = (r.province || '').slice(0, 27).padEnd(28);
        const oLat = r.oldLat !== null ? r.oldLat.toFixed(6).padEnd(14) : 'N/A'.padEnd(14);
        const oLon = r.oldLon !== null ? r.oldLon.toFixed(6).padEnd(14) : 'N/A'.padEnd(14);
        const nLat = r.newLat !== null ? r.newLat.toFixed(6).padEnd(14) : 'N/A'.padEnd(14);
        const nLon = r.newLon !== null ? r.newLon.toFixed(6).padEnd(14) : 'N/A'.padEnd(14);
        const upd = (r.updated || '').padEnd(9);
        const dLat = r.diffLat !== null ? r.diffLat.toFixed(6).padEnd(12) : 'N/A'.padEnd(12);
        const dLon = r.diffLon !== null ? r.diffLon.toFixed(6).padEnd(12) : 'N/A'.padEnd(12);
        const reason = r.reason || '';

        console.log(`${name} | ${prov} | ${oLat} | ${oLon} | ${nLat} | ${nLon} | ${upd} | ${dLat} | ${dLon} | ${reason}`);

        if (r.updated === 'YES') updatedCount++;
        else if (r.updated === 'SKIP' || r.updated === 'ERROR') skippedCount++;
        else noChangeCount++;
    }

    console.log('='.repeat(160));
    console.log(`Total pins audited: ${results.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`No change needed: ${noChangeCount}`);
    console.log(`Skipped/Error: ${skippedCount}`);
    if (DRY_RUN) console.log('\n** DRY RUN — no changes were written to the database **');
    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
