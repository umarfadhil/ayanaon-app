/**
 * scripts/seed-sumut-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Sumatera Utara Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-sumut-pins.js
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
// Pin data — 10 iconic & historic places in Sumatera Utara
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Danau Toba',
        description:
            'Danau Toba adalah danau vulkanik terbesar di dunia dan terbesar di Indonesia, ' +
            'terbentuk dari letusan supervulkan sekitar 74.000 tahun lalu di Sumatera Utara. ' +
            'Dengan luas sekitar 1.130 km² dan kedalaman hingga 505 meter, danau megah ini ' +
            'dikelilingi oleh lanskap pegunungan hijau yang memukau dan menjadi warisan geologi dunia.',
        lat: 2.660277,
        lng: 98.940833,
        province: 'Sumatera Utara',
        city: 'Kabupaten Simalungun',
        link: 'https://id.wikipedia.org/wiki/Danau_Toba',
        imageCandidates: [
            ['Lake_Toba_from_above.jpg', 'Lake_Toba.jpg', 'Danau_Toba.jpg'],
            ['Lake_Toba_Sumatra.jpg', 'Toba_lake.jpg', 'Lake_toba_indonesia.jpg'],
            ['Danau_Toba_aerial.jpg', 'Lake_Toba_aerial_view.jpg', 'Toba_Lake_Indonesia.jpg'],
        ],
    },
    {
        title: 'Istana Maimun',
        description:
            'Istana Maimun adalah istana kerajaan Kesultanan Deli yang terletak di pusat Kota Medan, ' +
            'Sumatera Utara. Dibangun pada tahun 1888 oleh Sultan Makmun Al Rasyid Perkasa Alamsyah, ' +
            'istana bergaya arsitektur Melayu, Islam, Spanyol, dan India ini memiliki 30 ruangan ' +
            'dan menjadi ikon budaya Melayu yang paling terkenal di Kota Medan.',
        lat: 3.574722,
        lng: 98.683056,
        province: 'Sumatera Utara',
        city: 'Kota Medan',
        link: 'https://id.wikipedia.org/wiki/Istana_Maimun',
        imageCandidates: [
            ['Maimun_Palace.jpg', 'Istana_Maimun.jpg', 'Maimun_Palace_Medan.jpg'],
            ['Istana_Maimun_Medan.jpg', 'Maimoon_Palace.jpg', 'Maimun_palace_front.jpg'],
            ['Maimun_palace_interior.jpg', 'Istana_Maimun_interior.jpg', 'Maimun_Medan.jpg'],
        ],
    },
    {
        title: 'Masjid Raya Al-Mashun',
        description:
            'Masjid Raya Al-Mashun atau Masjid Raya Medan adalah masjid bersejarah yang dibangun ' +
            'pada tahun 1906 atas perintah Sultan Makmun Al Rasyid dari Kesultanan Deli. ' +
            'Masjid megah bergaya arsitektur Melayu, Maroko, dan Timur Tengah ini mampu menampung ' +
            'ribuan jamaah dan menjadi salah satu masjid tertua dan paling ikonik di Sumatera.',
        lat: 3.580000,
        lng: 98.690556,
        province: 'Sumatera Utara',
        city: 'Kota Medan',
        link: 'https://id.wikipedia.org/wiki/Masjid_Raya_Al-Mashun',
        imageCandidates: [
            ['Al_Mashun_Grand_Mosque.jpg', 'Masjid_Raya_Medan.jpg', 'Al-Mashun_mosque.jpg'],
            ['Masjid_Al_Mashun_Medan.jpg', 'Al_Mashun_mosque_Medan.jpg', 'Masjid_raya_al_mashun.jpg'],
            ['Al_Mashun_exterior.jpg', 'Mesjid_Raya_Medan.jpg', 'Grand_Mosque_Medan.jpg'],
        ],
    },
    {
        title: 'Air Terjun Sipiso-Piso',
        description:
            'Air Terjun Sipiso-Piso adalah salah satu air terjun tertinggi di Indonesia dengan ' +
            'ketinggian sekitar 120 meter, terletak di tepi Danau Toba di Kabupaten Karo, ' +
            'Sumatera Utara. Air terjun yang menakjubkan ini mengalir dari aliran bawah tanah ' +
            'di lereng Gunung Sipiso-piso dan menjadi destinasi wisata alam yang sangat populer.',
        lat: 2.923333,
        lng: 98.514444,
        province: 'Sumatera Utara',
        city: 'Kabupaten Karo',
        link: 'https://id.wikipedia.org/wiki/Air_Terjun_Sipiso-Piso',
        imageCandidates: [
            ['Sipiso-piso_waterfall.jpg', 'Sipiso_Piso_Waterfall.jpg', 'Sipiso-Piso.jpg'],
            ['Air_terjun_Sipiso-Piso.jpg', 'Sipiso_piso.jpg', 'Waterfall_Sipiso_Piso.jpg'],
            ['Sipiso-piso_Falls.jpg', 'Sipiso_Piso_Falls.jpg', 'Sipiso-piso_Lake_Toba.jpg'],
        ],
    },
    {
        title: 'Pulau Samosir',
        description:
            'Pulau Samosir adalah pulau vulkanik yang terletak di tengah Danau Toba, ' +
            'menjadikannya salah satu pulau-di-dalam-danau terbesar di dunia. ' +
            'Pulau ini merupakan pusat kebudayaan Suku Batak Toba dengan rumah adat, ' +
            'makam raja-raja Batak, museum, dan pemandangan Danau Toba yang spektakuler dari semua sisi.',
        lat: 2.638333,
        lng: 98.812500,
        province: 'Sumatera Utara',
        city: 'Kabupaten Samosir',
        link: 'https://id.wikipedia.org/wiki/Pulau_Samosir',
        imageCandidates: [
            ['Samosir_Island.jpg', 'Pulau_Samosir.jpg', 'Samosir_island_Lake_Toba.jpg'],
            ['Samosir.jpg', 'Samosir_Lake_Toba.jpg', 'Samosir_Island_Indonesia.jpg'],
            ['Tuk_Tuk_Samosir.jpg', 'Tuktuk_Samosir.jpg', 'Samosir_aerial.jpg'],
        ],
    },
    {
        title: 'Bukit Lawang',
        description:
            'Bukit Lawang adalah kawasan ekowisata dan pintu gerbang menuju Taman Nasional ' +
            'Gunung Leuser di Kabupaten Langkat, Sumatera Utara. Kawasan ini terkenal sebagai ' +
            'habitat orangutan Sumatera yang hampir punah dan menjadi salah satu tempat ' +
            'terbaik di dunia untuk menyaksikan orangutan liar di habitat aslinya.',
        lat: 3.561111,
        lng: 98.127222,
        province: 'Sumatera Utara',
        city: 'Kabupaten Langkat',
        link: 'https://id.wikipedia.org/wiki/Bukit_Lawang',
        imageCandidates: [
            ['Bukit_Lawang.jpg', 'Orangutan_Bukit_Lawang.jpg', 'Bukit_lawang_village.jpg'],
            ['Sumatran_orangutan_Bukit_Lawang.jpg', 'Orangutan_Sumatra.jpg', 'Bukit_Lawang_river.jpg'],
            ['Bukit_Lawang_Langkat.jpg', 'Orangutan_in_Bukit_Lawang.jpg', 'Leuser_Bukit_Lawang.jpg'],
        ],
    },
    {
        title: 'Kota Berastagi',
        description:
            'Berastagi adalah kota dataran tinggi yang sejuk di Kabupaten Karo, Sumatera Utara, ' +
            'yang terkenal dengan pasar buah tropis, perkebunan, dan pemandangan dua gunung berapi aktif ' +
            'yaitu Gunung Sinabung dan Gunung Sibayak. Kota ini juga kaya akan tradisi budaya ' +
            'Suku Karo dan menjadi destinasi wisata pegunungan terfavorit di Sumatera Utara.',
        lat: 3.193611,
        lng: 98.514722,
        province: 'Sumatera Utara',
        city: 'Kabupaten Karo',
        link: 'https://id.wikipedia.org/wiki/Berastagi,_Berastagi,_Karo',
        imageCandidates: [
            ['Berastagi.jpg', 'Brastagi_market.jpg', 'Berastagi_Karo.jpg'],
            ['Sinabung_from_Berastagi.jpg', 'Gunung_Sinabung_Berastagi.jpg', 'Sinabung_Berastagi.jpg'],
            ['Berastagi_fruit_market.jpg', 'Pasar_Berastagi.jpg', 'Karo_Berastagi.jpg'],
        ],
    },
    {
        title: 'Rumah Tjong A Fie',
        description:
            'Rumah Tjong A Fie adalah mansion bersejarah bergaya arsitektur Tionghoa-Melayu-Eropa ' +
            'yang dibangun pada awal abad ke-20 oleh Tjong A Fie, seorang saudagar kaya dan ' +
            'dermawan legendaris asal Tiongkok di Kota Medan. Bangunan dua lantai dengan 35 kamar ' +
            'ini kini menjadi museum yang menyimpan koleksi benda-benda antik bernilai sejarah tinggi.',
        lat: 3.588056,
        lng: 98.677222,
        province: 'Sumatera Utara',
        city: 'Kota Medan',
        link: 'https://id.wikipedia.org/wiki/Rumah_Tjong_A_Fie',
        imageCandidates: [
            ['Tjong_A_Fie_Mansion.jpg', 'Rumah_Tjong_A_Fie.jpg', 'Tjong_A_Fie_mansion_Medan.jpg'],
            ['Tjong_A_Fie_Medan.jpg', 'Tjong_A_Fie_house.jpg', 'Tjong_a_fie_mansion.jpg'],
            ['Tjong_A_Fie_interior.jpg', 'Tjong_A_Fie_Museum.jpg', 'Tjong_a_Fie.jpg'],
        ],
    },
    {
        title: 'Museum Batak, Balige',
        description:
            'Museum Batak di Balige, Kabupaten Toba, adalah museum yang didedikasikan untuk ' +
            'melestarikan dan memamerkan warisan budaya Suku Batak dari seluruh Sumatera Utara. ' +
            'Museum yang didirikan oleh TB Silalahi Center ini menyimpan ribuan artefak budaya, ' +
            'pakaian adat, senjata tradisional, alat musik, dan benda-benda bersejarah Suku Batak.',
        lat: 2.329444,
        lng: 99.063333,
        province: 'Sumatera Utara',
        city: 'Kabupaten Toba',
        link: 'https://id.wikipedia.org/wiki/Museum_Batak',
        imageCandidates: [
            ['Museum_Batak.jpg', 'TB_Silalahi_Center.jpg', 'Museum_Batak_Balige.jpg'],
            ['Museum_Batak_Toba.jpg', 'Batak_Museum.jpg', 'TB_Silalahi_museum.jpg'],
            ['Museum_Batak_exterior.jpg', 'Balige_museum.jpg', 'Batak_museum_Silalahi.jpg'],
        ],
    },
    {
        title: 'Salib Kasih',
        description:
            'Salib Kasih adalah monumen salib besar yang berdiri di puncak Bukit Siatas Barita ' +
            'di atas Kota Tarutung, Kabupaten Tapanuli Utara, Sumatera Utara. ' +
            'Monumen setinggi 31 meter ini dibangun untuk mengenang misi penginjilan pertama di ' +
            'Sumatera Utara oleh misionaris Jerman Ingwer Ludwig Nommensen pada tahun 1863, ' +
            'dan kini menjadi tempat ziarah bersejarah bagi umat Kristiani di Indonesia.',
        lat: 2.009167,
        lng: 98.981111,
        province: 'Sumatera Utara',
        city: 'Kabupaten Tapanuli Utara',
        link: 'https://id.wikipedia.org/wiki/Salib_Kasih',
        imageCandidates: [
            ['Salib_Kasih.jpg', 'Salib_Kasih_Tarutung.jpg', 'Cross_Tarutung.jpg'],
            ['Salib_kasih_Tarutung.jpg', 'Salib_kasih.jpg', 'Cross_of_Love_Tarutung.jpg'],
            ['Tarutung_Salib_Kasih.jpg', 'Bukit_Siatas_Barita.jpg', 'Salib_Kasih_monument.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Sumatera Utara)');
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
