/**
 * scripts/seed-riau-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Riau Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-riau-pins.js
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
// Pin data — 10 iconic & historic places in Riau
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Istana Siak Sri Indrapura',
        description:
            'Istana Siak Sri Indrapura adalah istana megah peninggalan Kesultanan Siak yang terletak ' +
            'di Kota Siak Sri Indrapura, Kabupaten Siak, Riau. Dibangun pada tahun 1889 oleh Sultan ' +
            'Syarif Hasyim II dengan perpaduan arsitektur Melayu, Arab, dan Eropa, istana ini ' +
            'kini menjadi museum dan situs warisan budaya yang menyimpan koleksi benda-benda kerajaan bernilai tinggi.',
        lat: 0.766111,
        lng: 102.093889,
        province: 'Riau',
        city: 'Kabupaten Siak',
        link: 'https://id.wikipedia.org/wiki/Istana_Siak_Sri_Indrapura',
        imageCandidates: [
            ['Istana_Siak_Sri_Indrapura.jpg', 'Siak_Palace.jpg', 'Istana_Siak.jpg'],
            ['Siak_Sri_Indrapura_Palace.jpg', 'Palace_of_Siak.jpg', 'Istana_siak_riau.jpg'],
            ['Istana_Siak_facade.jpg', 'Siak_palace_entrance.jpg', 'Siak_Riau_palace.jpg'],
        ],
    },
    {
        title: 'Candi Muara Takus',
        description:
            'Candi Muara Takus adalah kompleks candi Buddha tertua di Sumatera yang terletak di ' +
            'tepi Sungai Kampar Kanan, Kabupaten Kampar, Riau. Kompleks candi yang diperkirakan ' +
            'berasal dari abad ke-4 hingga ke-11 Masehi ini merupakan bukti peradaban Kerajaan Sriwijaya ' +
            'dan menjadi situs arkeologi paling penting di Provinsi Riau.',
        lat: 0.459722,
        lng: 100.818611,
        province: 'Riau',
        city: 'Kabupaten Kampar',
        link: 'https://id.wikipedia.org/wiki/Candi_Muara_Takus',
        imageCandidates: [
            ['Candi_Muara_Takus.jpg', 'Muara_Takus_temple.jpg', 'Muara_Takus.jpg'],
            ['Muara_Takus_Buddhist_temple.jpg', 'Candi_muara_takus.jpg', 'Temple_Muara_Takus.jpg'],
            ['Muara_Takus_Kampar.jpg', 'Muara_Takus_stupa.jpg', 'Candi_Muaratakus.jpg'],
        ],
    },
    {
        title: 'Masjid Agung An-Nur Pekanbaru',
        description:
            'Masjid Agung An-Nur adalah masjid termegah dan terbesar di Provinsi Riau yang ' +
            'terletak di pusat Kota Pekanbaru. Masjid berarsitektur Timur Tengah dengan kubah ' +
            'besar dan empat menara menjulang ini dapat menampung lebih dari 4.500 jamaah dan ' +
            'menjadi landmark keislaman utama Kota Pekanbaru sejak diresmikan pada tahun 1968.',
        lat: 0.530556,
        lng: 101.447778,
        province: 'Riau',
        city: 'Kota Pekanbaru',
        link: 'https://id.wikipedia.org/wiki/Masjid_Agung_An-Nur',
        imageCandidates: [
            ['Masjid_Agung_An-Nur.jpg', 'An_Nur_mosque_Pekanbaru.jpg', 'Masjid_An_Nur_Pekanbaru.jpg'],
            ['An-Nur_mosque.jpg', 'Masjid_Annur_Pekanbaru.jpg', 'Masjid_An-Nur_Riau.jpg'],
            ['An_Nur_Grand_Mosque.jpg', 'Pekanbaru_mosque.jpg', 'Masjid_Riau_Pekanbaru.jpg'],
        ],
    },
    {
        title: 'Museum Sang Nila Utama',
        description:
            'Museum Sang Nila Utama adalah museum provinsi Riau yang terletak di Kota Pekanbaru, ' +
            'menyimpan dan memamerkan koleksi benda-benda bersejarah dan budaya Melayu Riau. ' +
            'Museum yang dinamai sesuai raja legendaris pendiri Singapura dari keturunan Melayu ini ' +
            'memiliki koleksi ribuan artefak tradisional, pakaian adat, keramik, dan naskah kuno.',
        lat: 0.519722,
        lng: 101.443056,
        province: 'Riau',
        city: 'Kota Pekanbaru',
        link: 'https://id.wikipedia.org/wiki/Museum_Sang_Nila_Utama',
        imageCandidates: [
            ['Museum_Sang_Nila_Utama.jpg', 'Sang_Nila_Utama_museum.jpg', 'Museum_Riau.jpg'],
            ['Museum_sang_nila_utama_pekanbaru.jpg', 'Sang_Nila_Utama.jpg', 'Museum_Provinsi_Riau.jpg'],
            ['Sang_Nila_Utama_museum_exterior.jpg', 'Riau_provincial_museum.jpg', 'Museum_Melayu_Riau.jpg'],
        ],
    },
    {
        title: 'Masjid Raya Senapelan',
        description:
            'Masjid Raya Senapelan atau Masjid Raya Pekanbaru adalah masjid tertua di Kota Pekanbaru ' +
            'yang didirikan pada tahun 1762 oleh Raja Muda Siak bersama tokoh-tokoh masyarakat setempat. ' +
            'Berlokasi di kawasan Kampung Bandar yang merupakan cikal bakal Kota Pekanbaru, masjid ini ' +
            'memiliki nilai sejarah sangat tinggi sebagai saksi bisu perkembangan Islam di Riau.',
        lat: 0.542778,
        lng: 101.453889,
        province: 'Riau',
        city: 'Kota Pekanbaru',
        link: 'https://id.wikipedia.org/wiki/Masjid_Raya_Senapelan',
        imageCandidates: [
            ['Masjid_Raya_Senapelan.jpg', 'Masjid_Senapelan.jpg', 'Senapelan_mosque.jpg'],
            ['Masjid_raya_senapelan_pekanbaru.jpg', 'Masjid_Senapelan_Pekanbaru.jpg', 'Raya_Senapelan.jpg'],
            ['Senapelan_Grand_Mosque.jpg', 'Pekanbaru_old_mosque.jpg', 'Masjid_Pekanbaru_lama.jpg'],
        ],
    },
    {
        title: 'Jembatan Siak',
        description:
            'Jembatan Siak atau Jembatan Tengku Agung Sultanah Latifah adalah jembatan ' +
            'gantung modern yang membentang di atas Sungai Siak di Kota Pekanbaru, Riau. ' +
            'Jembatan sepanjang 1.196 meter ini menjadi salah satu ikon arsitektur modern ' +
            'Kota Pekanbaru dan landmark penting yang menghubungkan sisi utara dan selatan kota.',
        lat: 0.531389,
        lng: 101.454167,
        province: 'Riau',
        city: 'Kota Pekanbaru',
        link: 'https://id.wikipedia.org/wiki/Jembatan_Siak',
        imageCandidates: [
            ['Jembatan_Siak.jpg', 'Siak_Bridge_Pekanbaru.jpg', 'Siak_bridge.jpg'],
            ['Jembatan_Siak_Pekanbaru.jpg', 'Bridge_Siak_River.jpg', 'Siak_River_Bridge.jpg'],
            ['Jembatan_siak_malam.jpg', 'Siak_bridge_night.jpg', 'Pekanbaru_bridge.jpg'],
        ],
    },
    {
        title: 'Kelenteng Hok Tek Bio',
        description:
            'Kelenteng Hok Tek Bio adalah kelenteng Tionghoa tertua di Kota Pekanbaru yang ' +
            'didirikan sekitar tahun 1878 dan berlokasi di kawasan Chinatown Pekanbaru. ' +
            'Kelenteng yang dipersembahkan untuk Dewa Bumi (Hok Tek Cheng Sin) ini merupakan ' +
            'pusat kegiatan keagamaan dan budaya masyarakat Tionghoa Pekanbaru selama lebih dari satu abad.',
        lat: 0.537500,
        lng: 101.455833,
        province: 'Riau',
        city: 'Kota Pekanbaru',
        link: 'https://id.wikipedia.org/wiki/Kelenteng_Hok_Tek_Bio',
        imageCandidates: [
            ['Kelenteng_Hok_Tek_Bio.jpg', 'Hok_Tek_Bio_Pekanbaru.jpg', 'Kelenteng_Pekanbaru.jpg'],
            ['Hok_Tek_Bio_temple.jpg', 'Chinese_temple_Pekanbaru.jpg', 'Pekanbaru_kelenteng.jpg'],
            ['Hok_Tek_Bio_exterior.jpg', 'Kelenteng_Hok_Tek_Pekanbaru.jpg', 'Chinese_temple_Riau.jpg'],
        ],
    },
    {
        title: 'Rumah Melayu Selaso Jatuh Kembar',
        description:
            'Rumah Melayu Selaso Jatuh Kembar adalah rumah adat tradisional masyarakat Melayu Riau ' +
            'yang digunakan sebagai tempat bermusyawarah dan kegiatan adat. ' +
            'Bangunan adat yang megah ini mencerminkan falsafah budaya Melayu Riau dan kini ' +
            'menjadi simbol identitas kebudayaan Melayu serta salah satu ikon budaya Provinsi Riau.',
        lat: 0.512500,
        lng: 101.451111,
        province: 'Riau',
        city: 'Kota Pekanbaru',
        link: 'https://id.wikipedia.org/wiki/Rumah_Melayu_Selaso_Jatuh_Kembar',
        imageCandidates: [
            ['Balai_Adat_Melayu_Riau.jpg', 'Rumah_Melayu_Riau.jpg', 'Selaso_Jatuh_Kembar.jpg'],
            ['Rumah_adat_Melayu_Riau.jpg', 'Balai_adat_Riau.jpg', 'Melayu_traditional_house.jpg'],
            ['Rumah_Melayu_Selaso.jpg', 'Adat_house_Riau.jpg', 'Traditional_Malay_house_Riau.jpg'],
        ],
    },
    {
        title: 'Danau PLTA Koto Panjang',
        description:
            'Danau PLTA Koto Panjang adalah danau buatan yang terbentuk akibat pembangunan ' +
            'Pembangkit Listrik Tenaga Air Koto Panjang di Kabupaten Kampar, Riau. ' +
            'Danau yang terbentang luas di tengah perbukitan hijau ini menawarkan pemandangan ' +
            'alam yang indah dengan hamparan air biru dikelilingi hutan tropis dan menjadi ' +
            'destinasi wisata alam andalan Kabupaten Kampar.',
        lat: 0.384167,
        lng: 100.731944,
        province: 'Riau',
        city: 'Kabupaten Kampar',
        link: 'https://id.wikipedia.org/wiki/Waduk_Koto_Panjang',
        imageCandidates: [
            ['Koto_Panjang_reservoir.jpg', 'Danau_PLTA_Koto_Panjang.jpg', 'Koto_Panjang_dam.jpg'],
            ['Waduk_Koto_Panjang.jpg', 'Koto_Panjang_lake.jpg', 'PLTA_Koto_Panjang.jpg'],
            ['Koto_Panjang_Kampar.jpg', 'Kampar_reservoir.jpg', 'Danau_Koto_Panjang_Riau.jpg'],
        ],
    },
    {
        title: 'Benteng Tujuh Lapis',
        description:
            'Benteng Tujuh Lapis adalah situs benteng bersejarah peninggalan Kerajaan Rokan ' +
            'yang terletak di Kabupaten Rokan Hulu, Riau. Benteng kuno yang dibangun dengan ' +
            'tujuh lapis tanah dan parit pertahanan ini merupakan bukti kejayaan Kerajaan Rokan ' +
            'pada masa lampau dan kini menjadi cagar budaya serta situs arkeologi penting di Riau.',
        lat: 0.934167,
        lng: 100.290000,
        province: 'Riau',
        city: 'Kabupaten Rokan Hulu',
        link: 'https://id.wikipedia.org/wiki/Benteng_Tujuh_Lapis',
        imageCandidates: [
            ['Benteng_Tujuh_Lapis.jpg', 'Benteng_Rokan.jpg', 'Tujuh_Lapis_fortress.jpg'],
            ['Benteng_tujuh_lapis_Rokan.jpg', 'Fort_Rokan_Hulu.jpg', 'Rokan_Hulu_heritage.jpg'],
            ['Benteng_lapis_Riau.jpg', 'Rokan_fortress.jpg', 'Benteng_bersejarah_Riau.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Riau)');
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
