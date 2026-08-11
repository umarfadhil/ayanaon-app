'use strict';

/**
 * scripts/mirror-db-to-local.js
 *
 * Copies documents from the production Mongo database (`ayanaon-db`) into the
 * isolated local-dev database (`ayanaon-local`, see wrangler.jsonc's `env.local`
 * and ai-memory/CODE_RULES.md) so `npm run dev` shows real pins/merchants
 * without ever writing to production and without needing a deploy first.
 *
 * Same cluster, different database name on the SAME MongoClient — no
 * mongodump/mongorestore binaries required, just the `mongodb` driver already
 * used by this repo's other scripts/ (see audit-iconic-pins.js convention).
 *
 * SAFETY:
 *  - Read-only against the source database. Only ever writes to TARGET_DB.
 *  - Refuses to run if SOURCE_DB === TARGET_DB.
 *  - Dry-run by default (prints what WOULD be copied). Pass --yes to write.
 *  - By default only copies app-content collections (pins, merchants, areas,
 *    brands, settings) — NOT sellers/residents/analytics_events/unique_ips/
 *    gather_runs/gather_pin_drafts, which hold account credentials, personal
 *    data, or visitor IPs. Pass --all to include everything, or
 *    --collections=pins,merchants to pick a custom set.
 *
 * Usage:
 *   MONGODB_URI=<uri> node scripts/mirror-db-to-local.js                # dry run
 *   MONGODB_URI=<uri> node scripts/mirror-db-to-local.js --yes          # actually copy the safe subset
 *   MONGODB_URI=<uri> node scripts/mirror-db-to-local.js --yes --all    # copy every collection, PII included
 *   node scripts/mirror-db-to-local.js --yes                           # falls back to MONGODB_URI in .dev.vars.local / .dev.vars
 *   MONGODB_URI=<uri> node scripts/mirror-db-to-local.js --revert --yes # drops the ENTIRE ayanaon-local database
 *
 * Re-run any time you want a fresh snapshot — each targeted collection is
 * dropped and fully replaced, not merged.
 *
 * IMPORTANT — shared storage quota: on an Atlas free/shared tier (M0/M2/M5),
 * `ayanaon-local` lives on the SAME cluster and counts against the SAME
 * storage quota as production `ayanaon-db`. Mirroring a large collection (or
 * --all) can push a near-full M0 (512 MB) over its limit and get writes
 * blocked cluster-wide, including for production. Check current Atlas
 * storage usage before mirroring on a free tier, prefer a small
 * --collections= subset over --all, and use --revert (below) to immediately
 * free the space back up if that happens.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const SOURCE_DB = 'ayanaon-db';
const TARGET_DB = 'ayanaon-local';
const BATCH_SIZE = 500;

const SAFE_COLLECTIONS = ['pins', 'merchants', 'areas', 'brands', 'settings'];
const PII_OR_INTERNAL_COLLECTIONS = [
    'sellers',
    'residents',
    'analytics_events',
    'unique_ips',
    'gather_runs',
    'gather_pin_drafts',
];

function readDevVarsUri() {
    for (const file of ['.dev.vars.local', '.dev.vars']) {
        const filePath = path.join(__dirname, '..', file);
        if (!fs.existsSync(filePath)) continue;
        const line = fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .find((l) => l.trim().startsWith('MONGODB_URI='));
        if (line) {
            const value = line.slice(line.indexOf('=') + 1).trim();
            if (value) return { uri: value, source: file };
        }
    }
    return null;
}

function parseArgs(argv) {
    const flags = { yes: false, all: false, collections: null, revert: false };
    for (const arg of argv) {
        if (arg === '--yes') flags.yes = true;
        else if (arg === '--all') flags.all = true;
        else if (arg === '--revert') flags.revert = true;
        else if (arg.startsWith('--collections=')) {
            flags.collections = arg.slice('--collections='.length).split(',').map((s) => s.trim()).filter(Boolean);
        }
    }
    return flags;
}

/**
 * Drops the entire TARGET_DB (never SOURCE_DB — hardcoded, not parameterized)
 * to fully undo a mirror and free the space back up. This is a delete-only
 * operation, so it still runs even while Atlas has writes blocked for being
 * over the storage quota (the block only stops operations that grow storage).
 */
async function revertMirror(client, flags) {
    if (!flags.yes) {
        console.log(`DRY RUN — would drop the entire "${TARGET_DB}" database. Pass --yes to actually do it.`);
        return;
    }
    console.log(`Dropping database "${TARGET_DB}"...`);
    const result = await client.db(TARGET_DB).dropDatabase();
    console.log(`Dropped. (${JSON.stringify(result)})`);
    console.log('Space is freed immediately on drop — re-check Atlas storage usage / retry your write in a minute.');
}

async function main() {
    const flags = parseArgs(process.argv.slice(2));

    let uri = process.env.MONGODB_URI;
    let uriSource = 'MONGODB_URI env var';
    if (!uri) {
        const fromDevVars = readDevVarsUri();
        if (fromDevVars) {
            uri = fromDevVars.uri;
            uriSource = fromDevVars.source;
        }
    }
    if (!uri) {
        console.error('MONGODB_URI is not set and no .dev.vars.local/.dev.vars with MONGODB_URI= was found.');
        console.error('Usage: MONGODB_URI=<uri> node scripts/mirror-db-to-local.js [--yes] [--all] [--collections=a,b]');
        process.exit(1);
    }

    if (SOURCE_DB === TARGET_DB) {
        console.error(`Refusing to run: SOURCE_DB and TARGET_DB are both "${SOURCE_DB}".`);
        process.exit(1);
    }

    if (flags.revert) {
        console.log(`Mongo URI source: ${uriSource}`);
        const client = new MongoClient(uri);
        await client.connect();
        try {
            await revertMirror(client, flags);
        } finally {
            await client.close();
        }
        return;
    }

    const collections = flags.collections
        ? flags.collections
        : flags.all
            ? [...SAFE_COLLECTIONS, ...PII_OR_INTERNAL_COLLECTIONS]
            : SAFE_COLLECTIONS;

    console.log(`Mongo URI source: ${uriSource}`);
    console.log(`Copying ${SOURCE_DB} -> ${TARGET_DB}: ${collections.join(', ')}`);
    if (!flags.all && !flags.collections) {
        console.log(`(Skipping PII/internal collections: ${PII_OR_INTERNAL_COLLECTIONS.join(', ')} — pass --all or --collections= to include them.)`);
    }
    if (!flags.yes) {
        console.log('\nDRY RUN — pass --yes to actually write to the target database. No changes made.\n');
    }

    const client = new MongoClient(uri);
    await client.connect();
    try {
        const sourceDb = client.db(SOURCE_DB);
        const targetDb = client.db(TARGET_DB);

        for (const name of collections) {
            const sourceCount = await sourceDb.collection(name).estimatedDocumentCount();
            if (sourceCount === 0) {
                console.log(`  ${name}: 0 documents in source, skipping.`);
                continue;
            }

            if (!flags.yes) {
                console.log(`  ${name}: would copy ${sourceCount} documents.`);
                continue;
            }

            const targetCollection = targetDb.collection(name);
            await targetCollection.deleteMany({});

            const cursor = sourceDb.collection(name).find({});
            let batch = [];
            let copied = 0;
            while (await cursor.hasNext()) {
                batch.push(await cursor.next());
                if (batch.length >= BATCH_SIZE) {
                    await targetCollection.insertMany(batch, { ordered: false });
                    copied += batch.length;
                    batch = [];
                }
            }
            if (batch.length > 0) {
                await targetCollection.insertMany(batch, { ordered: false });
                copied += batch.length;
            }
            console.log(`  ${name}: copied ${copied}/${sourceCount} documents.`);
        }

        if (flags.yes) {
            console.log('\nDone. Indexes are created automatically the next time `npm run dev` connects (ensureIndexes()).');
        }
    } finally {
        await client.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
