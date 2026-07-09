/**
 * scripts/seed-bali-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Bali Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-bali-pins.js
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
// Pin data — 10 iconic & historic places in Bali
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Pura Besakih',
        description:
            'Pura Besakih adalah kompleks pura terbesar dan paling suci di Pulau Bali, terletak di lereng ' +
            'selatan Gunung Agung pada ketinggian sekitar 1.000 meter di atas permukaan laut di Kabupaten ' +
            'Karangasem. Pura induk ini dikenal sebagai "Ibu Pura" atau "Mother Temple" karena dianggap ' +
            'sebagai pusat spiritual seluruh pura di Bali. Kompleks seluas 3 km² ini terdiri dari 86 pura ' +
            'individual, dengan Pura Penataran Agung sebagai pura terbesar yang memiliki teras-teras suci ' +
            'bertingkat dan meru (menara suci) hingga 11 tingkat. Pura ini telah menjadi pusat upacara ' +
            'keagamaan Hindu Bali selama berabad-abad dan termasuk dalam daftar tentatif Warisan Dunia UNESCO.',
        lat: -8.373611,
        lng: 115.450833,
        province: 'Bali',
        city: 'Kabupaten Karangasem',
        link: 'https://id.wikipedia.org/wiki/Pura_Besakih',
        imageCandidates: [
            ['Pura_Besakih.JPG', 'Pura_Besakih_Bali42.jpg', 'Besakih_Temple.jpg'],
            ['Mother_Temple_of_Besakih.jpg', 'Besakih_temple_bali.jpg', 'Pura_Besakih_temple.jpg'],
            ['Besakih_Pura_Bali.jpg', 'Besakih_complex_Bali.jpg', 'Pura_Penataran_Agung_Besakih.jpg'],
        ],
    },
    {
        title: 'Pura Tanah Lot',
        description:
            'Pura Tanah Lot adalah pura Hindu yang berdiri di atas batu karang lepas pantai di Kabupaten ' +
            'Tabanan, Bali, dan merupakan salah satu situs keagamaan paling ikonik sekaligus tujuan wisata ' +
            'paling populer di Pulau Bali. Pura ini didirikan oleh pendeta Hindu dari Jawa bernama Dang ' +
            'Hyang Nirartha pada abad ke-16 saat menyebarkan agama Hindu di Bali, dan dipercaya sebagai ' +
            'tempat bersemayamnya dewa penjaga laut. Pada saat air laut pasang, batu karang tempat pura ' +
            'berdiri seolah mengapung di tengah lautan, menciptakan pemandangan dramatis yang selalu ' +
            'memukau jutaan wisatawan setiap tahunnya. Pura Tanah Lot juga terkenal sebagai spot ' +
            'terbaik untuk menikmati matahari terbenam di Bali.',
        lat: -8.621178,
        lng: 115.086930,
        province: 'Bali',
        city: 'Kabupaten Tabanan',
        link: 'https://id.wikipedia.org/wiki/Pura_Tanah_Lot',
        imageCandidates: [
            ['20070423_Pura_Tanah_Lot_-_Low_Tide.JPG', 'Tanah_Lot_Temple_Bali.jpg', 'Pura_Tanah_Lot.jpg'],
            ['Tanah_lot_temple_bali_indonesia.jpg', 'Tanah_Lot_at_sunset.jpg', 'Bali_Tanah_Lot.jpg'],
            ['Tanah_Lot_(Bali).jpg', 'Tanah_Lot_full_view.jpg', 'Tanah_Lot_temple_panorama.jpg'],
        ],
    },
    {
        title: 'Pura Luhur Uluwatu',
        description:
            'Pura Luhur Uluwatu adalah pura Hindu yang terletak di ujung tebing karang setinggi 70 meter ' +
            'di atas permukaan laut di Kecamatan Kuta Selatan, Kabupaten Badung, Bali. Pura ini merupakan ' +
            'salah satu dari enam pura utama yang disebut "Sad Kahyangan" atau pura penjaga kosmis Pulau ' +
            'Bali, dan dibangun pada abad ke-11 oleh pendeta suci Mpu Kuturan. Lokasinya di tepi tebing ' +
            'yang menghadap langsung ke Samudra Hindia menjadikannya salah satu situs paling dramatis ' +
            'dan indah di seluruh Bali. Kawasan ini juga terkenal dengan pertunjukan Tari Kecak yang ' +
            'diadakan setiap sore dengan latar belakang matahari terbenam yang spektakuler.',
        lat: -8.829556,
        lng: 115.088861,
        province: 'Bali',
        city: 'Kabupaten Badung',
        link: 'https://id.wikipedia.org/wiki/Pura_Luhur_Uluwatu',
        imageCandidates: [
            ['Uluwatu_Temple_Cliff,_Bali.jpg', 'Uluwatu_temple_bali_indonesia.jpg', 'Pura_Uluwatu_Bali.jpg'],
            ['Uluwatu_temple.jpg', 'Uluwatu_cliff_temple_Bali.jpg', 'Pura_Luhur_Uluwatu.jpg'],
            ['Uluwatu_Temple_at_sunset.jpg', 'Uluwatu_Bali.jpg', 'Uluwatu_Sunset.JPG'],
        ],
    },
    {
        title: 'Pura Tirta Empul',
        description:
            'Pura Tirta Empul adalah pura Hindu yang terkenal dengan mata air suci dan kolam pemandian ' +
            'yang digunakan untuk upacara melukat (penyucian diri) di Desa Tampaksiring, Kabupaten Gianyar, ' +
            'Bali. Pura ini didirikan sekitar tahun 962 Masehi pada masa pemerintahan Raja Sri Candrabhaya ' +
            'Singha Warmadewa dan dipercaya memiliki air yang memberkati, menyembuhkan, dan memurnikan jiwa ' +
            'bagi umat Hindu yang melakukan ritual di sana. Kompleks pura ini terdiri dari tiga halaman ' +
            'suci dengan dua kolam pemandian utama yang dilengkapi 30 pancuran air suci. Tirta Empul ' +
            'termasuk dalam kelompok Pura Kahyangan Jagat dan merupakan salah satu situs warisan budaya ' +
            'paling penting di Bali.',
        lat: -8.415292,
        lng: 115.316527,
        province: 'Bali',
        city: 'Kabupaten Gianyar',
        link: 'https://id.wikipedia.org/wiki/Pura_Tirta_Empul',
        imageCandidates: [
            ['Pura_Tirta_Empul,_Bali.JPG', 'Tirta_Empul_temple_(16435530914).jpg', 'Tirta_Empul_Bali.jpg'],
            ['Pura_Tirta_Empul_holy_spring.jpg', 'Tirta_empul_temple_bali.jpg', 'Tirta_Empul_purification.jpg'],
            ['Tirta_Empul_Bali_Indonesia.jpg', 'Holy_spring_temple_Bali.jpg', 'Tampaksiring_Bali_temple.jpg'],
        ],
    },
    {
        title: 'Pura Ulun Danu Bratan',
        description:
            'Pura Ulun Danu Bratan adalah pura Hindu yang berdiri di tepi Danau Bratan di kawasan pegunungan ' +
            'Bedugul, Kabupaten Tabanan, Bali, pada ketinggian sekitar 1.239 meter di atas permukaan laut. ' +
            'Pura yang dibangun pada tahun 1633 ini didedikasikan kepada Dewi Danu, dewi air, danau, dan ' +
            'sungai, dan merupakan salah satu pura paling penting dalam sistem pengairan sawah bertingkat ' +
            '(subak) yang kini diakui sebagai Warisan Budaya Dunia UNESCO. Meru sebelas tingkat yang ' +
            'berdiri di tepi danau menciptakan refleksi yang memukau di permukaan air, menjadikannya ' +
            'salah satu pemandangan paling ikonik di Bali yang kerap muncul di majalah dan buku panduan ' +
            'wisata internasional.',
        lat: -8.275278,
        lng: 115.166389,
        province: 'Bali',
        city: 'Kabupaten Tabanan',
        link: 'https://id.wikipedia.org/wiki/Pura_Ulun_Danu_Bratan',
        imageCandidates: [
            ['Pura_Ulun_Danu_Bratan_A.JPG', 'Pura_Ulun_Danu_Bratan_8.JPG', 'Pura_Ulun_Danu_Beratan_Bali.jpg'],
            ['Ulun_Danu_Beratan_temple_Bali.jpg', 'Bali_Ulun_Danu_Bratan.jpg', 'Bedugul_temple_Bali.jpg'],
            ['Pura_Ulun_Danu_Bratan.jpg', 'Ulun_Danu_Bratan_meru.jpg', 'Danau_Bratan_temple.jpg'],
        ],
    },
    {
        title: 'Tegallalang Rice Terraces',
        description:
            'Tegallalang Rice Terraces adalah sawah bertingkat yang terletak di Desa Tegallalang, sekitar ' +
            '10 km sebelah utara Ubud, Kabupaten Gianyar, Bali, dan merupakan contoh paling indah dari ' +
            'sistem irigasi subak tradisional Bali. Terasering ini dibentuk oleh petani Bali selama ' +
            'berabad-abad menggunakan sistem irigasi subak yang diatur secara komunal berdasarkan filosofi ' +
            'Tri Hita Karana, dan kini diakui sebagai bagian dari Warisan Budaya Dunia UNESCO. Hijaunya ' +
            'hamparan sawah bertingkat yang membentuk pola-pola geometris menakjubkan di lembah sungai ' +
            'Pakerisan menjadikan Tegallalang sebagai salah satu pemandangan alam-budaya paling ikonik ' +
            'di Asia Tenggara. Kawasan ini juga diramaikan oleh berbagai kafe, warung, dan aktivitas ' +
            'swing di atas jurang yang memanjakan wisatawan.',
        lat: -8.431944,
        lng: 115.278611,
        province: 'Bali',
        city: 'Kabupaten Gianyar',
        link: 'https://id.wikipedia.org/wiki/Tegallalang,_Tegallalang,_Gianyar',
        imageCandidates: [
            ['Tegallalang_Rice_Terraces.jpg', 'Rice_terraces_in_Tegallalang_1.jpg', 'Tegallalang_rice_terrace_Bali.jpg'],
            ['Tegallalang_Bali_rice_fields.jpg', 'Bali_rice_terraces_tegallalang.jpg', 'Ubud_rice_terraces_Bali.jpg'],
            ['Tegallalang_rice_paddy_Bali.jpg', 'Sawah_Tegallalang_Bali.jpg', 'Rice_field_Tegallalang_Gianyar.jpg'],
        ],
    },
    {
        title: 'Goa Gajah',
        description:
            'Goa Gajah atau "Gua Gajah" adalah situs arkeologi Hindu-Buddha yang dibangun sekitar abad ' +
            'ke-9 hingga ke-11 Masehi di Desa Bedulu, Kecamatan Blahbatuh, Kabupaten Gianyar, Bali. ' +
            'Nama "Gajah" tidak merujuk pada hewan gajah, melainkan berasal dari kata "Lwa Gajah" yang ' +
            'merupakan nama sungai di dekatnya. Mulut gua ini dihiasi ukiran wajah raksasa (kala) yang ' +
            'sangat ekspresif dan membingkai pintu masuk gua yang sempit, sementara di dalamnya terdapat ' +
            'ceruk-ceruk meditasi dan lingga-yoni sebagai lambang kesuburan. Di luar gua terdapat kolam ' +
            'pemandian kuno dengan patung bidadari yang memancarkan air dari payudaranya. Situs ini ' +
            'telah ditetapkan sebagai Warisan Budaya Dunia UNESCO dan dilindungi sebagai Cagar Budaya ' +
            'Nasional Indonesia.',
        lat: -8.520722,
        lng: 115.285139,
        province: 'Bali',
        city: 'Kabupaten Gianyar',
        link: 'https://id.wikipedia.org/wiki/Goa_Gajah',
        imageCandidates: [
            ['Goa_Gajah_Front.JPG', 'Elephant_temple_(Goa_Gajah)_-_panoramio.jpg', 'Goa_Gajah_Bali.jpg'],
            ['Goa_Gajah_entrance.jpg', 'Goa_Gajah_Ubud_Bali.jpg', 'Elephant_cave_Bali.jpg'],
            ['Goa_Gajah_cave_entrance.jpg', 'Bali_Goa_Gajah.jpg', 'Goa_gajah_gianyar.jpg'],
        ],
    },
    {
        title: 'Pura Goa Lawah',
        description:
            'Pura Goa Lawah adalah pura Hindu suci yang dibangun di depan sebuah gua yang dihuni ribuan ' +
            'kelelawar (lawah dalam bahasa Bali) di pesisir selatan Kabupaten Klungkung, Bali. Pura ini ' +
            'merupakan salah satu dari enam "Sad Kahyangan" pura penjaga Pulau Bali dan diperkirakan ' +
            'dibangun pada abad ke-11 Masehi oleh pendeta suci Mpu Kuturan. Gua kelelawar yang terletak ' +
            'di belakang kompleks pura dipercaya menembus jauh ke dalam gunung dan terhubung dengan ' +
            'Pura Besakih di lereng Gunung Agung, sehingga memiliki makna spiritual yang sangat dalam ' +
            'bagi umat Hindu Bali. Ribuan kelelawar yang bergantungan di langit-langit gua menjadi ' +
            'pemandangan yang unik dan mengesankan bagi para pengunjung.',
        lat: -8.556700,
        lng: 115.457900,
        province: 'Bali',
        city: 'Kabupaten Klungkung',
        link: 'https://id.wikipedia.org/wiki/Pura_Goa_Lawah',
        imageCandidates: [
            ['Pura_Goa_Lawah_Klungkung_Bali.jpg', 'Goa_Lawah_temple_Bali.jpg', 'Goa_Lawah_Bali.jpg'],
            ['Bat_Cave_Temple_Bali.jpg', 'Pura_Goa_Lawah.jpg', 'Klungkung_bat_cave_temple.jpg'],
            ['Goa_Lawah_bat_cave_Bali.jpg', 'Pura_Goa_Lawah_temple.jpg', 'Bali_Goa_Lawah.jpg'],
        ],
    },
    {
        title: 'Pura Taman Ayun',
        description:
            'Pura Taman Ayun adalah pura kerajaan Mengwi yang dibangun oleh Raja Gusti Agung Anom pada ' +
            'tahun 1634 dan terletak di Desa Mengwi, Kabupaten Badung, Bali. Pura ini berfungsi sebagai ' +
            'pura keluarga kerajaan Mengwi dan merupakan pura terbesar kedua di Bali setelah Pura Besakih. ' +
            'Kompleks pura ini dikelilingi oleh parit berair yang luas sehingga tampak seperti mengapung ' +
            'di atas kolam besar, dengan meru-meru bertingkat yang menjulang tinggi di dalam halaman ' +
            'utama. Karena merupakan bagian integral dari sistem subak (irigasi pertanian tradisional Bali), ' +
            'Pura Taman Ayun diakui sebagai bagian dari Lanskap Budaya Bali yang terdaftar sebagai ' +
            'Warisan Budaya Dunia UNESCO sejak tahun 2012.',
        lat: -8.541850,
        lng: 115.172490,
        province: 'Bali',
        city: 'Kabupaten Badung',
        link: 'https://id.wikipedia.org/wiki/Pura_Taman_Ayun',
        imageCandidates: [
            ['Pura_taman_ayun_bali_2011.jpg', 'Air_Mancur_dan_Kolam_di_Pura_Taman_Ayun.jpg', 'Taman_Ayun_Temple_Bali.jpg'],
            ['Pura_Taman_Ayun_Mengwi.jpg', 'Taman_Ayun_temple_Mengwi_Bali.jpg', 'Pura_Taman_Ayun.jpg'],
            ['Taman_Ayun_Bali.jpg', 'Mengwi_royal_temple_Bali.jpg', 'Taman_Ayun_meru_Bali.jpg'],
        ],
    },
    {
        title: 'Puri Agung Karangasem',
        description:
            'Puri Agung Karangasem adalah istana kerajaan bersejarah milik Raja Karangasem yang terletak ' +
            'di pusat Kota Amlapura, Kabupaten Karangasem, Bali. Istana ini dibangun pada akhir abad ke-19 ' +
            'dan awal abad ke-20 dan menampilkan perpaduan arsitektur yang unik antara gaya tradisional ' +
            'Bali, Eropa, dan Tiongkok, mencerminkan hubungan diplomatik dan perdagangan yang luas dari ' +
            'Kerajaan Karangasem. Kompleks istana ini terdiri dari beberapa bangunan megah di antaranya ' +
            'Maskerdam (tempat menerima tamu Belanda), Bale Kambang (pavilion yang mengapung di tengah ' +
            'kolam), dan Bale London (ruang pertemuan dengan sentuhan arsitektur kolonial). Istana ini ' +
            'telah menjadi museum budaya hidup yang menampilkan koleksi artefak kerajaan, foto-foto ' +
            'bersejarah, dan karya seni Bali yang bernilai tinggi.',
        lat: -8.443560,
        lng: 115.615980,
        province: 'Bali',
        city: 'Kabupaten Karangasem',
        link: 'https://id.wikipedia.org/wiki/Puri_Agung_Karangasem',
        imageCandidates: [
            ['Puri_Agung_Karangasem,_Bali.jpg', 'Karangasem_Palace_Bali.jpg', 'Puri_Karangasem_Bali.jpg'],
            ['Puri_Agung_Karangasem.jpg', 'Amlapura_palace_Bali.jpg', 'Karangasem_royal_palace.jpg'],
            ['Puri_Karangasem_entrance.jpg', 'Amlapura_Bali_palace.jpg', 'Puri_Agung_Bali.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Bali)');
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
