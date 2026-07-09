/**
 * scripts/seed-kepri-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Kepulauan Riau Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-kepri-pins.js
 *
 * Options:
 *   --dry-run      Print pins that would be inserted without writing to DB
 *   --skip-images  Insert pins without downloading images (faster, no photos)
 */

'use strict';

const { MongoClient } = require('mongodb');
const axios = require('axios');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'ayanaon-db';
const COLLECTION = 'pins';
const CATEGORY = '🏰 Tempat Ikonik & Bersejarah';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_IMAGES = process.argv.includes('--skip-images');

const MAX_IMAGE_BYTES = 1024 * 1024;
const WIKIMEDIA_THUMB_WIDTH = 900;
const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';
const HTTP_TIMEOUT_MS = 30_000;

const HTTP_HEADERS = {
    'User-Agent': 'AyaNaon-Seeder/1.0 (https://ayanaon.app)',
    Accept: 'image/jpeg,image/png,image/webp,image/*',
};

// ---------------------------------------------------------------------------
// Pin data — 10 iconic & historic places in Kepulauan Riau
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Masjid Raya Sultan Riau, Pulau Penyengat',
        description:
            'Masjid Raya Sultan Riau adalah masjid bersejarah abad ke-19 yang terletak di ' +
            'Pulau Penyengat, Kota Tanjungpinang, Kepulauan Riau. Legenda menyebutkan masjid ini ' +
            'dibangun menggunakan campuran putih telur sebagai bahan perekat dindingnya. ' +
            'Masjid dengan empat menara dan tiga kubah kuning ini merupakan simbol kejayaan ' +
            'Kesultanan Riau-Lingga dan menjadi ikon kebanggaan Kepulauan Riau.',
        lat: 0.940278,
        lng: 104.538056,
        province: 'Kepulauan Riau',
        city: 'Kota Tanjungpinang',
        link: 'https://id.wikipedia.org/wiki/Masjid_Raya_Sultan_Riau',
        imageCandidates: [
            ['Masjid_Raya_Sultan_Riau.jpg', 'Sultan_Riau_Mosque.jpg', 'Masjid_Penyengat.jpg'],
            ['Masjid_Sultan_Riau_Penyengat.jpg', 'Penyengat_mosque.jpg', 'Masjid_Raya_Penyengat.jpg'],
            ['Sultan_Riau_mosque_Penyengat.jpg', 'Riau_mosque_Penyengat.jpg', 'Yellow_mosque_Penyengat.jpg'],
        ],
    },
    {
        title: 'Jembatan Barelang',
        description:
            'Jembatan Barelang adalah rangkaian enam jembatan yang menghubungkan Pulau Batam ' +
            'dengan Pulau Rempang, Pulau Galang, dan pulau-pulau sekitarnya di Kota Batam, ' +
            'Kepulauan Riau. Jembatan pertama yang menggunakan sistem cable-stayed sepanjang ' +
            '642 meter ini menjadi ikon arsitektur kebanggaan Kota Batam dan destinasi wisata foto populer.',
        lat: 1.103611,
        lng: 104.031667,
        province: 'Kepulauan Riau',
        city: 'Kota Batam',
        link: 'https://id.wikipedia.org/wiki/Jembatan_Barelang',
        imageCandidates: [
            ['Jembatan_Barelang.jpg', 'Barelang_Bridge.jpg', 'Barelang_bridge_Batam.jpg'],
            ['Barelang_Bridge_Batam.jpg', 'Bridge_Barelang.jpg', 'Jembatan_barelang_batam.jpg'],
            ['Barelang_bridge_sunset.jpg', 'Batam_Barelang.jpg', 'Jembatan_Barelang_Kepri.jpg'],
        ],
    },
    {
        title: 'Istana Kota Piring',
        description:
            'Istana Kota Piring adalah situs bekas istana Kerajaan Bintan yang terletak di ' +
            'Kabupaten Bintan, Kepulauan Riau, diperkirakan berasal dari abad ke-13 hingga ke-15 Masehi. ' +
            'Reruntuhan bangunan yang tersisa di kawasan hutan ini menyimpan nilai sejarah tinggi ' +
            'sebagai peninggalan Kerajaan Bintan yang pernah berjaya di Selat Malaka.',
        lat: 0.873889,
        lng: 104.519444,
        province: 'Kepulauan Riau',
        city: 'Kabupaten Bintan',
        link: 'https://id.wikipedia.org/wiki/Istana_Kota_Piring',
        imageCandidates: [
            ['Istana_Kota_Piring.jpg', 'Kota_Piring_palace.jpg', 'Bintan_palace_ruins.jpg'],
            ['Kota_Piring_Bintan.jpg', 'Istana_kota_piring_Bintan.jpg', 'Bintan_heritage_site.jpg'],
            ['Kota_Piring_ruins.jpg', 'Bintan_historical_site.jpg', 'Istana_Bintan_kuno.jpg'],
        ],
    },
    {
        title: 'Benteng Bukit Kursi, Pulau Penyengat',
        description:
            'Benteng Bukit Kursi adalah benteng pertahanan bersejarah yang terletak di puncak ' +
            'Bukit Kursi, Pulau Penyengat, Kota Tanjungpinang. Dibangun pada masa Kesultanan ' +
            'Riau-Lingga sebagai pos pertahanan, benteng ini kini menjadi situs warisan budaya ' +
            'yang menawarkan pemandangan panoramik indah Selat Riau dan Kota Tanjungpinang.',
        lat: 0.939167,
        lng: 104.536389,
        province: 'Kepulauan Riau',
        city: 'Kota Tanjungpinang',
        link: 'https://id.wikipedia.org/wiki/Benteng_Bukit_Kursi',
        imageCandidates: [
            ['Benteng_Bukit_Kursi.jpg', 'Bukit_Kursi_fort.jpg', 'Penyengat_fortress.jpg'],
            ['Benteng_Penyengat.jpg', 'Fort_Bukit_Kursi.jpg', 'Penyengat_island_fort.jpg'],
            ['Bukit_Kursi_Penyengat.jpg', 'Penyengat_heritage.jpg', 'Tanjungpinang_fortress.jpg'],
        ],
    },
    {
        title: 'Vihara Duta Maitreya',
        description:
            'Vihara Duta Maitreya adalah salah satu vihara Buddha terbesar di Asia Tenggara ' +
            'yang terletak di Kota Batam, Kepulauan Riau. Kompleks vihara megah ini menampilkan ' +
            'patung Budai (Maitreya) raksasa setinggi 30 meter yang menjadi landmark paling ' +
            'mencolok dan ikon religius kebanggaan Kota Batam.',
        lat: 1.068611,
        lng: 103.983333,
        province: 'Kepulauan Riau',
        city: 'Kota Batam',
        link: 'https://id.wikipedia.org/wiki/Vihara_Duta_Maitreya',
        imageCandidates: [
            ['Vihara_Duta_Maitreya.jpg', 'Maitreya_temple_Batam.jpg', 'Duta_Maitreya_vihara.jpg'],
            ['Maitreya_Batam.jpg', 'Vihara_Maitreya_Batam.jpg', 'Maitreya_statue_Batam.jpg'],
            ['Duta_Maitreya_Batam.jpg', 'Batam_Maitreya_temple.jpg', 'Vihara_Batam_Maitreya.jpg'],
        ],
    },
    {
        title: 'Pantai Trikora, Bintan',
        description:
            'Pantai Trikora adalah kawasan pantai sepanjang sekitar 60 km di sisi timur Pulau Bintan, ' +
            'Kabupaten Bintan, yang terkenal dengan pasir putih halus, air laut jernih berwarna biru ' +
            'kehijauan, dan deretan pohon kelapa yang rindang. Pantai yang masih terjaga keasriannya ' +
            'ini menjadi destinasi wisata bahari favorit warga Tanjungpinang dan wisatawan Singapura.',
        lat: 1.023611,
        lng: 104.658333,
        province: 'Kepulauan Riau',
        city: 'Kabupaten Bintan',
        link: 'https://id.wikipedia.org/wiki/Pantai_Trikora',
        imageCandidates: [
            ['Pantai_Trikora.jpg', 'Trikora_beach_Bintan.jpg', 'Trikora_Beach.jpg'],
            ['Pantai_Trikora_Bintan.jpg', 'Bintan_Trikora_beach.jpg', 'Trikora_beach.jpg'],
            ['Beach_Trikora_Bintan.jpg', 'Pantai_Trikora_Indonesia.jpg', 'Bintan_beach_Trikora.jpg'],
        ],
    },
    {
        title: 'Lagoi Bay, Bintan',
        description:
            'Lagoi Bay adalah kawasan resor wisata bahari premium di pesisir utara Pulau Bintan, ' +
            'Kabupaten Bintan, Kepulauan Riau. Kawasan seluas 23.000 hektar ini menawarkan ' +
            'pantai berpasir putih, resor bintang lima, lapangan golf bertaraf internasional, ' +
            'dan berbagai wahana air yang menjadikannya destinasi wisata bertaraf dunia.',
        lat: 1.203333,
        lng: 104.555556,
        province: 'Kepulauan Riau',
        city: 'Kabupaten Bintan',
        link: 'https://id.wikipedia.org/wiki/Bintan_Resorts',
        imageCandidates: [
            ['Lagoi_Bay_Bintan.jpg', 'Bintan_Lagoi.jpg', 'Lagoi_Bintan.jpg'],
            ['Bintan_Resort.jpg', 'Bintan_Resorts.jpg', 'Lagoi_beach_Bintan.jpg'],
            ['Bintan_island_resort.jpg', 'Lagoi_Bintan_resort.jpg', 'Bintan_resort_beach.jpg'],
        ],
    },
    {
        title: 'Masjid Sultan Lingga, Daik',
        description:
            'Masjid Sultan Lingga adalah masjid bersejarah peninggalan Kesultanan Lingga yang ' +
            'terletak di Kota Daik, ibu kota Kabupaten Lingga, Kepulauan Riau. ' +
            'Bangunan masjid kuno ini berdiri berdampingan dengan reruntuhan Istana Damnah dan ' +
            'makam sultan-sultan Lingga, menjadikan kawasan Daik sebagai pusat warisan budaya ' +
            'Melayu-Islam yang paling penting di Kepulauan Riau.',
        lat: -0.220556,
        lng: 104.614444,
        province: 'Kepulauan Riau',
        city: 'Kabupaten Lingga',
        link: 'https://id.wikipedia.org/wiki/Masjid_Sultan_Lingga',
        imageCandidates: [
            ['Masjid_Sultan_Lingga.jpg', 'Sultan_Lingga_mosque.jpg', 'Daik_Lingga_mosque.jpg'],
            ['Masjid_Lingga.jpg', 'Lingga_mosque.jpg', 'Daik_mosque_Lingga.jpg'],
            ['Lingga_Sultan_mosque.jpg', 'Masjid_Daik.jpg', 'Lingga_heritage_mosque.jpg'],
        ],
    },
    {
        title: 'Istana Damnah, Daik Lingga',
        description:
            'Istana Damnah adalah reruntuhan istana Kesultanan Riau-Lingga yang terletak di ' +
            'Daik, Kabupaten Lingga, Kepulauan Riau. Dibangun pada abad ke-19 sebagai pusat ' +
            'pemerintahan Kesultanan Riau-Lingga, istana yang kini tinggal pondasinya ini ' +
            'menyimpan nilai sejarah tinggi dan menjadi bagian dari kawasan wisata heritage Pulau Lingga.',
        lat: -0.218889,
        lng: 104.613333,
        province: 'Kepulauan Riau',
        city: 'Kabupaten Lingga',
        link: 'https://id.wikipedia.org/wiki/Istana_Damnah',
        imageCandidates: [
            ['Istana_Damnah.jpg', 'Damnah_palace_ruins.jpg', 'Istana_Damnah_Lingga.jpg'],
            ['Damnah_Lingga.jpg', 'Daik_Lingga_palace.jpg', 'Lingga_palace_ruins.jpg'],
            ['Istana_Daik.jpg', 'Damnah_palace.jpg', 'Lingga_heritage_palace.jpg'],
        ],
    },
    {
        title: 'Patung Welcome to Batam',
        description:
            'Patung Welcome to Batam adalah monumen ikonik berbentuk tangan yang berada di ' +
            'kawasan Nagoya, Kota Batam, Kepulauan Riau. Monumen ini menjadi simbol ' +
            'keramahan dan kemajuan Kota Batam sebagai kota industri dan perdagangan bebas ' +
            'terdepan di Indonesia, serta menjadi spot foto favorit wisatawan yang datang ke Batam.',
        lat: 1.118611,
        lng: 104.048611,
        province: 'Kepulauan Riau',
        city: 'Kota Batam',
        link: 'https://id.wikipedia.org/wiki/Kota_Batam',
        imageCandidates: [
            ['Welcome_to_Batam.jpg', 'Batam_monument.jpg', 'Patung_Batam.jpg'],
            ['Batam_welcome_sign.jpg', 'Batam_city_monument.jpg', 'Welcome_Batam_sign.jpg'],
            ['Batam_landmark.jpg', 'Nagoya_Batam.jpg', 'Batam_iconic_monument.jpg'],
        ],
    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
    return crypto.randomBytes(8).toString('hex');
}

async function getWikimediaThumbUrl(filename) {
    try {
        const params = new URLSearchParams({
            action: 'query',
            titles: `File:${filename}`,
            prop: 'imageinfo',
            iiprop: 'url',
            iiurlwidth: String(WIKIMEDIA_THUMB_WIDTH),
            format: 'json',
            origin: '*',
        });
        const response = await axios.get(`${WIKIMEDIA_API}?${params}`, {
            timeout: HTTP_TIMEOUT_MS,
            headers: { 'User-Agent': HTTP_HEADERS['User-Agent'] },
        });
        const pages = response.data?.query?.pages || {};
        const page = Object.values(pages)[0];
        if (!page || page.missing !== undefined) return null;
        const info = page.imageinfo?.[0];
        return info?.thumburl || info?.url || null;
    } catch {
        return null;
    }
}

async function downloadImage(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            maxRedirects: 10,
            timeout: HTTP_TIMEOUT_MS,
            headers: HTTP_HEADERS,
        });
        const buffer = Buffer.from(response.data);
        if (buffer.length > MAX_IMAGE_BYTES) {
            console.warn(
                `    ⚠  Too large (${(buffer.length / 1024).toFixed(0)} KB > 1024 KB): ${url}`
            );
            return null;
        }
        const contentType =
            (response.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
        const base64 = buffer.toString('base64');
        const dataUrl = `data:${contentType};base64,${base64}`;
        const urlPath = new URL(url).pathname;
        const originalName = decodeURIComponent(urlPath.split('/').pop());
        return {
            _id: generateId(),
            dataUrl,
            data: base64,
            contentType,
            size: buffer.length,
            originalName,
        };
    } catch (err) {
        console.warn(`    ⚠  Download failed: ${url} — ${err.message}`);
        return null;
    }
}

async function resolveImageSlot(candidates) {
    for (const filename of candidates) {
        const thumbUrl = await getWikimediaThumbUrl(filename);
        if (!thumbUrl) {
            process.stdout.write(`    · ${filename} — not found on Commons\n`);
            continue;
        }
        process.stdout.write(`    · ${filename} → downloading…\n`);
        const img = await downloadImage(thumbUrl);
        if (img) {
            console.log(`      ✓ ${img.originalName} (${(img.size / 1024).toFixed(0)} KB)`);
            return img;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    if (!MONGODB_URI && !DRY_RUN) {
        console.error('Error: MONGODB_URI environment variable is not set.');
        process.exit(1);
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Kepulauan Riau)');
    console.log('═══════════════════════════════════════════════════════════');
    if (DRY_RUN) console.log(' Mode: DRY RUN (no writes)');
    if (SKIP_IMAGES) console.log(' Images: SKIPPED');
    console.log('');

    let client;
    let pinsCollection;

    if (!DRY_RUN) {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        console.log('Connected to MongoDB.\n');
        pinsCollection = client.db(DB_NAME).collection(COLLECTION);
    }

    const results = { inserted: 0, skipped: 0, errors: 0 };

    for (const pinData of PINS) {
        console.log(`📍 ${pinData.title}`);

        if (!DRY_RUN) {
            const existing = await pinsCollection.findOne({
                title: pinData.title,
                category: CATEGORY,
            });
            if (existing) {
                console.log(`   ↩  Already exists (${existing._id}) — skipping.\n`);
                results.skipped++;
                continue;
            }
        }

        const images = [];
        if (!SKIP_IMAGES) {
            for (const candidates of pinData.imageCandidates) {
                if (images.length >= 3) break;
                const img = await resolveImageSlot(candidates);
                if (img) images.push(img);
            }
            console.log(`   Images collected: ${images.length}/3`);
        }

        const pinDoc = {
            title: pinData.title,
            description: pinData.description,
            category: CATEGORY,
            lat: pinData.lat,
            lng: pinData.lng,
            link: pinData.link || '',
            lifetime: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            reporter: '127.0.0.1',
            upvotes: 0,
            downvotes: 0,
            upvoterIps: [],
            downvoterIps: [],
            province: pinData.province,
            city: pinData.city,
            images,
            imageCount: images.length,
        };

        if (DRY_RUN) {
            console.log(`   [dry-run] Would insert: ${pinData.title}`);
            console.log(
                `   Fields: lat=${pinData.lat}, lng=${pinData.lng}, images=${images.length}\n`
            );
            results.inserted++;
            continue;
        }

        try {
            const result = await pinsCollection.insertOne(pinDoc);
            console.log(`   ✅ Inserted: ${result.insertedId}\n`);
            results.inserted++;
        } catch (err) {
            console.error(`   ❌ Failed to insert: ${err.message}\n`);
            results.errors++;
        }
    }

    if (client) await client.close();

    console.log('═══════════════════════════════════════════════════════════');
    console.log(` Done! Inserted: ${results.inserted}  Skipped: ${results.skipped}  Errors: ${results.errors}`);
    console.log('═══════════════════════════════════════════════════════════');
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
