/**
 * scripts/seed-ntt-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Nusa Tenggara Timur (NTT) Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-ntt-pins.js
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
// Pin data — 10 iconic & historic places in Nusa Tenggara Timur
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Taman Nasional Komodo',
        description:
            'Taman Nasional Komodo adalah kawasan konservasi alam yang terletak di antara Pulau Sumbawa ' +
            '(NTB) dan Pulau Flores (NTT), mencakup Pulau Komodo, Pulau Rinca, Pulau Padar, dan beberapa ' +
            'pulau kecil lainnya di Kabupaten Manggarai Barat, Nusa Tenggara Timur. Taman nasional ini ' +
            'merupakan satu-satunya habitat alami di dunia bagi Komodo (Varanus komodoensis), kadal ' +
            'terbesar yang masih hidup di bumi dan sering disebut "naga terakhir di dunia" yang bisa ' +
            'tumbuh hingga 3 meter dan berbobot 70 kilogram. Taman Nasional Komodo telah ditetapkan ' +
            'sebagai Warisan Alam Dunia UNESCO sejak 1991 dan juga termasuk dalam daftar Tujuh Keajaiban ' +
            'Alam Baru Dunia. Pusat utama pengunjung terletak di Loh Liang di Pulau Komodo, tempat ' +
            'ranger bertugas memandu wisatawan menjumpai komodo di habitat aslinya.',
        lat: -8.569500,
        lng: 119.499200,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Manggarai Barat',
        link: 'https://id.wikipedia.org/wiki/Taman_Nasional_Komodo',
        imageCandidates: [
            ['Komodo_dragon_(Varanus_komodoensis).jpg', 'Komodo_dragon_walking.JPG', 'Large_komodo_dragon_on_stairs.JPG'],
            ['Komodo_National_Park_Indonesia.jpg', 'Komodo_island_NTT.jpg', 'Varanus_komodoensis_Komodo.jpg'],
            ['Komodo_dragon_Rinca_Island.jpg', 'Loh_Liang_Komodo_Island.jpg', 'Komodo_National_Park_NTT.jpg'],
        ],
    },
    {
        title: 'Pulau Padar',
        description:
            'Pulau Padar adalah pulau ketiga terbesar di kawasan Taman Nasional Komodo, terletak di ' +
            'antara Pulau Komodo dan Pulau Rinca di Kabupaten Manggarai Barat, Nusa Tenggara Timur. ' +
            'Pulau ini terkenal karena pemandangannya yang sangat dramatis dari puncak bukit tertingginya, ' +
            'di mana pengunjung dapat melihat tiga teluk yang berbeda dengan warna pasir yang berbeda-beda: ' +
            'pasir hitam, putih, dan merah muda. Panorama bukit-bukit kering bergelombang yang dikelilingi ' +
            'perairan biru tosca dan teluk-teluk indah menjadikan Pulau Padar sebagai salah satu ' +
            'pemandangan paling ikonik dan banyak difoto di seluruh Indonesia. Jalur pendakian menuju ' +
            'puncak memerlukan waktu sekitar 30-45 menit dan merupakan satu dari pengalaman wisata ' +
            'paling berkesan di kawasan Flores.',
        lat: -8.654000,
        lng: 119.574000,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Manggarai Barat',
        link: 'https://id.wikipedia.org/wiki/Pulau_Padar',
        imageCandidates: [
            ['A_Sunset_Hike_in_Padar_Island.jpg', 'Adelaar_off_Padar_Island_(1998).jpg', 'Padar_island_Komodo.jpg'],
            ['Pulau_Padar_NTT.jpg', 'Padar_Island_viewpoint.jpg', 'Padar_Island_Flores.jpg'],
            ['Komodo_National_Park_Padar.jpg', 'Padar_island_three_bays.jpg', 'Pulau_Padar_Manggarai.jpg'],
        ],
    },
    {
        title: 'Pantai Merah (Pink Beach Komodo)',
        description:
            'Pantai Merah atau Pink Beach adalah salah satu pantai berpasir merah muda yang langka di ' +
            'dunia, terletak di sisi timur laut Pulau Komodo dalam kawasan Taman Nasional Komodo, ' +
            'Kabupaten Manggarai Barat, Nusa Tenggara Timur. Warna merah muda pasirnya berasal dari ' +
            'pecahan karang merah jenis Foraminifera (Homotrema rubrum) yang bercampur dengan butiran ' +
            'pasir putih di sepanjang garis pantai. Perairan di sekitar Pantai Merah memiliki ' +
            'keanekaragaman hayati bawah laut yang luar biasa kaya, dengan berbagai jenis ikan, kura-kura, ' +
            'mantra ray, dan terumbu karang yang masih sangat terjaga. Pantai ini hanya dapat dicapai ' +
            'dengan kapal dari Labuan Bajo, dan merupakan salah satu tempat snorkeling dan menyelam ' +
            'terbaik di seluruh kawasan Komodo.',
        lat: -8.648500,
        lng: 119.548800,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Manggarai Barat',
        link: 'https://id.wikipedia.org/wiki/Taman_Nasional_Komodo',
        imageCandidates: [
            ['Pink_Beach_Komodo_Island.jpg', 'Pantai_Merah_Komodo.jpg', 'Pink_beach_Komodo_NTT.jpg'],
            ['Komodo_pink_beach.jpg', 'Pantai_Merah_Pulau_Komodo.jpg', 'Pink_sand_beach_Komodo.jpg'],
            ['Pink_Beach_Indonesia_Komodo.jpg', 'Flores_pink_beach.jpg', 'Komodo_pink_sand.jpg'],
        ],
    },
    {
        title: 'Danau Kelimutu',
        description:
            'Danau Kelimutu adalah tiga danau kawah vulkanik yang menakjubkan di puncak Gunung Kelimutu ' +
            'pada ketinggian 1.640 meter di atas permukaan laut di Kabupaten Ende, Pulau Flores, Nusa ' +
            'Tenggara Timur. Keistimewaan utama Danau Kelimutu adalah kemampuan ketiga danaunya untuk ' +
            'berubah warna secara periodik dan tidak terduga — dari merah, cokelat, biru tua, hijau toska, ' +
            'hingga hitam — akibat perubahan kimia di dalam air danau yang dipengaruhi aktivitas vulkanik. ' +
            'Bagi masyarakat adat Lio, ketiga danau ini memiliki nama dan makna spiritual: Tiwu Ata Mbupu ' +
            '(danau jiwa orang tua), Tiwu Ko\'o Fai Uu Ata (danau jiwa muda-mudi), dan Tiwu Ata Polo ' +
            '(danau jiwa orang jahat). Kelimutu telah ditetapkan sebagai Kawasan Suaka Alam Kelimutu ' +
            'dan menjadi salah satu fenomena alam paling spektakuler di Indonesia.',
        lat: -8.768400,
        lng: 121.823600,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Ende',
        link: 'https://id.wikipedia.org/wiki/Danau_Kelimutu',
        imageCandidates: [
            ['Kelimutu_lakes.jpg', 'Kelimutulakes1.jpg', 'Kelimutu_lakes_-_Aqua_and_Chocolate.jpg'],
            ['Kelimutu_crater_lakes_Flores.jpg', 'Kelimutu_NTT_Indonesia.jpg', 'Danau_Kelimutu_Flores.jpg'],
            ['Kelimutu_colored_lakes.jpg', 'Ende_Kelimutu_Flores.jpg', 'Gunung_Kelimutu_crater.jpg'],
        ],
    },
    {
        title: 'Kampung Adat Wae Rebo',
        description:
            'Kampung Adat Wae Rebo adalah desa tradisional suku Manggarai yang terletak terpencil di ' +
            'pegunungan Flores pada ketinggian sekitar 1.200 meter di atas permukaan laut, di wilayah ' +
            'Kecamatan Satar Mese Barat, Kabupaten Manggarai, Nusa Tenggara Timur. Desa ini terkenal ' +
            'dengan tujuh rumah tradisional berbentuk kerucut yang disebut Mbaru Niang, dengan atap ' +
            'berbahan ijuk yang menjulur hingga hampir menyentuh tanah dan menjadi salah satu ikon ' +
            'arsitektur tradisional paling unik di Indonesia. Pada tahun 2012, UNESCO memberikan ' +
            'Penghargaan Pelestarian Warisan Budaya Asia-Pasifik kepada Wae Rebo atas upaya masyarakat ' +
            'dalam merestorasi dan mempertahankan rumah adat Mbaru Niang. Perjalanan menuju desa ini ' +
            'membutuhkan pendakian sekitar 2-3 jam melewati hutan hujan tropis yang lebat.',
        lat: -8.769600,
        lng: 120.283300,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Manggarai',
        link: 'https://id.wikipedia.org/wiki/Wae_Rebo',
        imageCandidates: [
            ['Wae_Rebo_village_Flores.jpg', 'Mbaru_Niang_Wae_Rebo.jpg', 'Wae_Rebo_traditional_house.jpg'],
            ['Wae_Rebo_Flores_Indonesia.jpg', 'Wae_Rebo_village.jpg', 'Wae_Rebo_Manggarai.jpg'],
            ['Mbaru_Niang_traditional_house_Flores.jpg', 'Wae_Rebo_NTT.jpg', 'Kampung_Wae_Rebo.jpg'],
        ],
    },
    {
        title: 'Benteng Concordia Kupang',
        description:
            'Benteng Concordia adalah benteng kolonial Portugis-Belanda yang dibangun pada abad ke-17 ' +
            'di pesisir Teluk Kupang, Kota Kupang, Nusa Tenggara Timur, dan merupakan situs bersejarah ' +
            'paling penting di ibu kota Provinsi NTT. Benteng ini awalnya dibangun oleh bangsa Portugis ' +
            'sekitar tahun 1640 dan kemudian diambil alih serta diperbesar oleh VOC Belanda, menjadi ' +
            'pusat kekuasaan kolonial di Timor bagian barat selama lebih dari dua abad. Lokasinya yang ' +
            'strategis di atas bukit menghadap Teluk Kupang memungkinkan pengawasan penuh atas jalur ' +
            'pelayaran dan perdagangan cendana yang sangat berharga pada masa itu. Reruntuhan dan bagian ' +
            'dinding benteng yang masih tersisa kini menjadi situs cagar budaya nasional yang menjadi ' +
            'saksi bisu sejarah panjang kolonialisme di Timor.',
        lat: -10.163700,
        lng: 123.587900,
        province: 'Nusa Tenggara Timur',
        city: 'Kota Kupang',
        link: 'https://id.wikipedia.org/wiki/Benteng_Concordia',
        imageCandidates: [
            ['Benteng_Concordia_Kupang.jpg', 'Fort_Concordia_Kupang_NTT.jpg', 'Kupang_fort_NTT.jpg'],
            ['Benteng_Kupang_NTT.jpg', 'Fort_Concordia_Timor.jpg', 'Kupang_historical_fort.jpg'],
            ['Benteng_Concordia_Timor.jpg', 'Kupang_old_fort.jpg', 'NTT_Kupang_fortress.jpg'],
        ],
    },
    {
        title: 'Gua Kristal Kupang',
        description:
            'Gua Kristal atau Gua Bolok adalah gua batu kapur yang unik dan indah terletak di Desa Bolok, ' +
            'Kecamatan Kupang Barat, Kabupaten Kupang, sekitar 17 km sebelah barat Kota Kupang, Nusa ' +
            'Tenggara Timur. Nama "Gua Kristal" berasal dari kejernihan air kolam di dalam gua yang ' +
            'tampak seperti kristal, memantulkan cahaya yang masuk dari celah-celah atap gua sehingga ' +
            'menciptakan pemandangan yang magis dan memukau. Di dalam gua ini terdapat beberapa kolam ' +
            'alami yang airnya sangat jernih dan dingin, dengan stalaktit dan stalagmit yang menghiasi ' +
            'dinding dan langit-langit gua selama ribuan tahun. Gua Kristal telah menjadi destinasi ' +
            'wisata alam unggulan di Timor Barat yang menarik perhatian wisatawan domestik dan ' +
            'mancanegara yang ingin berenang di kolam alami yang bening.',
        lat: -10.173800,
        lng: 123.532700,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Kupang',
        link: 'https://id.wikipedia.org/wiki/Gua_Kristal,_Kupang',
        imageCandidates: [
            ['Gua_Kristal_Kupang_NTT.jpg', 'Crystal_Cave_Kupang.jpg', 'Goa_Kristal_Bolok.jpg'],
            ['Gua_Kristal_NTT.jpg', 'Kupang_Crystal_Cave.jpg', 'Bolok_cave_Kupang.jpg'],
            ['Gua_Bolok_Kupang.jpg', 'Gua_Kristal_Timor.jpg', 'Crystal_cave_NTT_Indonesia.jpg'],
        ],
    },
    {
        title: 'Katedral Kristus Raja Ende',
        description:
            'Katedral Kristus Raja Ende adalah gereja Katolik katedral yang megah dan bersejarah yang ' +
            'berdiri di pusat Kota Ende, Kabupaten Ende, Pulau Flores, Nusa Tenggara Timur. Gereja ini ' +
            'merupakan pusat Keuskupan Agung Ende, salah satu keuskupan Katolik tertua dan terpenting ' +
            'di Indonesia yang berdiri sejak tahun 1913. Bangunan katedral bergaya neo-Gotik dengan ' +
            'dua menara kembar yang menjulang tinggi ini telah menjadi landmark visual paling ikonik ' +
            'di Kota Ende dan mencerminkan pengaruh misi Katolik yang sangat kuat di Pulau Flores. ' +
            'Ende sendiri memiliki nilai sejarah nasional yang penting karena pernah menjadi tempat ' +
            'pengasingan Bung Karno (1934-1938), dan di sinilah beliau merenungkan dan merumuskan ' +
            'konsep dasar Pancasila.',
        lat: -8.841400,
        lng: 121.663700,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Ende',
        link: 'https://id.wikipedia.org/wiki/Katedral_Kristus_Raja_Ende',
        imageCandidates: [
            ['Christ_the_King_Cathedral_Ende.jpg', 'Katedral_Kristus_Raja_Ende.jpg', 'Ende_Cathedral_Flores.jpg'],
            ['Cathedral_Ende_NTT.jpg', 'Ende_Flores_cathedral.jpg', 'Katedral_Ende_Flores.jpg'],
            ['Christ_King_Cathedral_Ende_Flores.jpg', 'Ende_Catholic_cathedral.jpg', 'Keuskupan_Agung_Ende.jpg'],
        ],
    },
    {
        title: 'Kampung Adat Bena',
        description:
            'Kampung Bena adalah salah satu kampung megalitik tertua yang masih dihuni di Pulau Flores, ' +
            'terletak di kaki Gunung Inerie di Kecamatan Aimere, Kabupaten Ngada, Nusa Tenggara Timur. ' +
            'Desa ini memiliki tata ruang yang khas berbentuk perahu dengan rumah-rumah adat tradisional ' +
            'suku Ngada yang berjajar di kedua sisi jalan utama kampung, sementara di tengahnya terdapat ' +
            'altar-altar batu megalitik berupa ngadhu (tiang bercungkup berbentuk payung) dan bhaga ' +
            '(miniatur rumah) yang merupakan simbol leluhur laki-laki dan perempuan. Kampung yang ' +
            'telah berdiri selama lebih dari 1.200 tahun ini masih memegang teguh adat-istiadat nenek ' +
            'moyang dan menjadi salah satu contoh paling autentik kebudayaan megalitik di Indonesia ' +
            'yang masih hidup hingga kini.',
        lat: -8.695800,
        lng: 120.993600,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Ngada',
        link: 'https://id.wikipedia.org/wiki/Bena,_Aimere,_Ngada',
        imageCandidates: [
            ['Kampung_Bena_Ngada_Flores.jpg', 'Bena_village_Flores_NTT.jpg', 'Kampung_adat_Bena.jpg'],
            ['Bena_megalithic_village_Flores.jpg', 'Bena_traditional_village_Ngada.jpg', 'Desa_Bena_Flores.jpg'],
            ['Ngada_traditional_village_Bena.jpg', 'Bena_Flores_Indonesia.jpg', 'Kampung_Bena_NTT.jpg'],
        ],
    },
    {
        title: 'Pantai Koka Flores',
        description:
            'Pantai Koka adalah salah satu pantai paling indah dan tersembunyi di Pulau Flores, terletak ' +
            'di Desa Wolowiro, Kecamatan Paga, Kabupaten Sikka, Nusa Tenggara Timur. Pantai ini terdiri ' +
            'dari dua teluk berbentuk tapal kuda yang diapit oleh tebing-tebing karang hijau yang lebat, ' +
            'dengan pasir putih yang sangat halus dan air laut yang jernih berwarna biru-tosca menakjubkan. ' +
            'Untuk mencapai pantai ini, pengunjung harus menuruni jalur setapak melewati ladang dan hutan ' +
            'selama sekitar 15-20 menit dari jalan utama Trans-Flores. Keindahan alami Pantai Koka yang ' +
            'masih sangat terjaga dan minim pembangunan menjadikannya permata tersembunyi yang dicari ' +
            'para pelancong yang ingin menjelajahi keajaiban alam Pulau Flores yang belum banyak dikenal.',
        lat: -8.728800,
        lng: 121.987500,
        province: 'Nusa Tenggara Timur',
        city: 'Kabupaten Sikka',
        link: 'https://id.wikipedia.org/wiki/Pantai_Koka',
        imageCandidates: [
            ['Pantai_Koka_Flores.jpg', 'Koka_Beach_Flores_NTT.jpg', 'Pantai_Koka_Sikka.jpg'],
            ['Koka_beach_Flores_Indonesia.jpg', 'Pantai_Koka_NTT.jpg', 'Flores_Koka_beach.jpg'],
            ['Wolowiro_beach_Flores.jpg', 'Koka_Flores_pantai.jpg', 'Sikka_beach_NTT.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (NTT)');
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
