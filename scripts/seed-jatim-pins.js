/**
 * scripts/seed-jatim-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Jawa Timur Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-jatim-pins.js
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
// Pin data — 10 iconic & historic places in Jawa Timur
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Gunung Bromo',
        description:
            'Gunung Bromo adalah gunung berapi aktif yang paling terkenal dan paling banyak dikunjungi ' +
            'di Indonesia, terletak di dalam Kaldera Tengger yang luas di Taman Nasional Bromo Tengger ' +
            'Semeru, Jawa Timur. Dengan ketinggian 2.329 meter di atas permukaan laut, Bromo ' +
            'merupakan bagian dari kompleks gunung berapi Tengger yang dikelilingi oleh lautan pasir ' +
            '("segara wedi") seluas sekitar 5.250 hektare. Pemandangan matahari terbit di atas ' +
            'lautan awan dengan siluet Gunung Semeru di latar belakang adalah salah satu pemandangan ' +
            'alam paling ikonik di Indonesia. Bagi masyarakat Tengger, Bromo adalah gunung suci ' +
            'tempat diadakannya upacara Kasada setiap tahun sebagai bentuk persembahan kepada ' +
            'leluhur dan dewa-dewa.',
        lat: -7.942965,
        lng: 112.953186,
        province: 'Jawa Timur',
        city: 'Kabupaten Probolinggo',
        link: 'https://id.wikipedia.org/wiki/Gunung_Bromo',
        imageCandidates: [
            ['Crater of Mount Bromo.JPG', 'Mount Bromo (2012).JPG'],
            ['Semeru Bromo Temple.JPG', 'Higher Perspective from Bromo.jpg'],
            ['Hiking Trail on the Crater of Mount Bromo.jpg', 'Mt. Bromo from afar.jpg'],
        ],
    },
    {
        title: 'Candi Penataran',
        description:
            'Candi Penataran adalah kompleks candi Hindu terbesar dan paling penting di Jawa Timur, ' +
            'terletak di Desa Penataran, Kecamatan Nglegok, Kabupaten Blitar, di lereng barat daya ' +
            'Gunung Kelud. Dibangun secara bertahap dari abad ke-12 hingga ke-15 Masehi, sejak masa ' +
            'Kerajaan Kediri hingga mencapai puncaknya pada masa Majapahit, candi yang juga dikenal ' +
            'sebagai Candi Palah ini merupakan candi negara Kerajaan Majapahit. Kompleksnya mencakup ' +
            'Candi Induk (Candi Penataran), Candi Naga, Bale Agung, dan berbagai bangunan pelengkap ' +
            'yang dihiasi relief Ramayana dan Krishnayana yang sangat indah. Candi ini juga terkait ' +
            'erat dengan sejarah Gajah Mada dan kejayaan Majapahit.',
        lat: -8.016100,
        lng: 112.209250,
        province: 'Jawa Timur',
        city: 'Kabupaten Blitar',
        link: 'https://id.wikipedia.org/wiki/Candi_Penataran',
        imageCandidates: [
            ['095 Naga and Main Temples (25559548157).jpg', '104 Temple from North-West (40387177362).jpg'],
            ['105 Temple from South-East (40387172322).jpg', '260 Side Temple (40387776522).jpg'],
            ['193 Krishnayana Reliefs (40431925461).jpg', '303 Temple View (39534833025).jpg'],
        ],
    },
    {
        title: 'Tugu Pahlawan Surabaya',
        description:
            'Tugu Pahlawan adalah monumen bersejarah yang dibangun untuk mengenang perjuangan para ' +
            'pahlawan dalam Pertempuran Surabaya pada 10 November 1945, salah satu pertempuran paling ' +
            'berdarah dalam sejarah kemerdekaan Indonesia. Terletak di pusat Kota Surabaya, monumen ' +
            'berbentuk paku terbalik setinggi 40,45 meter ini resmi dibuka oleh Presiden Sukarno pada ' +
            '10 November 1952. Tanggal 10 November kemudian ditetapkan sebagai Hari Pahlawan Nasional ' +
            'Indonesia. Di bawah monumen terdapat Museum Sepuluh Nopember yang menyimpan koleksi ' +
            'foto, dokumentasi, diorama, dan artefak pertempuran. Tugu Pahlawan merupakan simbol ' +
            'kebanggaan dan semangat juang Kota Surabaya yang mendapat julukan "Kota Pahlawan".',
        lat: -7.245555,
        lng: 112.737863,
        province: 'Jawa Timur',
        city: 'Kota Surabaya',
        link: 'https://id.wikipedia.org/wiki/Tugu_Pahlawan',
        imageCandidates: [
            ['Tugu Pahlawan Surabaya.jpg', 'Heroic Monument Surabaya.jpg'],
            ['Tugu Pahlawan.jpg', 'Tugu pahlawan.jpg'],
            ['Monumen tugu pahlawan,surabaya jawa timur,indonesia.jpg', 'Museum Tugu Pahlawan Surabaya.jpg'],
        ],
    },
    {
        title: 'Masjid Ampel Surabaya',
        description:
            'Masjid Ampel adalah masjid bersejarah yang dibangun pada tahun 1421 Masehi oleh Raden ' +
            'Rahmat, yang lebih dikenal sebagai Sunan Ampel, salah satu dari Wali Songo — sembilan ' +
            'ulama penyebar Islam di Pulau Jawa. Terletak di Kelurahan Ampel, Kecamatan Semampir, ' +
            'Surabaya, masjid ini merupakan salah satu masjid tertua di Indonesia dan menjadi pusat ' +
            'penyebaran Islam di Jawa bagian timur pada abad ke-15. Makam Sunan Ampel yang berada ' +
            'di dalam kompleks masjid menjadi salah satu tempat ziarah paling ramai dikunjungi di ' +
            'Indonesia. Kawasan Ampel di sekitarnya berkembang menjadi kampung Arab yang semarak ' +
            'dengan toko-toko penjual perhiasan, pakaian, dan makanan khas Timur Tengah.',
        lat: -7.229960,
        lng: 112.742840,
        province: 'Jawa Timur',
        city: 'Kota Surabaya',
        link: 'https://id.wikipedia.org/wiki/Masjid_Ampel',
        imageCandidates: [
            ['Makam Sunan Ampel.jpg', 'COLLECTIE TROPENMUSEUM Poort bij de Ampel Moskee in de Arabische wijk van Soerabaja TMnr 60037907.jpg'],
            ['Makam Sunan Ampel.jpg', 'COLLECTIE TROPENMUSEUM Poort bij de Ampel Moskee in de Arabische wijk van Soerabaja TMnr 60037907.jpg'],
            ['COLLECTIE TROPENMUSEUM Poort bij de Ampel Moskee in de Arabische wijk van Soerabaja TMnr 60037907.jpg', 'Makam Sunan Ampel.jpg'],
        ],
    },
    {
        title: 'Kawah Ijen',
        description:
            'Kawah Ijen adalah danau kawah vulkanik yang terkenal di seluruh dunia karena api biru ' +
            '("blue fire") yang langka dan spektakuler, dihasilkan oleh pembakaran gas belerang yang ' +
            'keluar dari celah-celah kawah. Terletak di perbatasan Kabupaten Banyuwangi dan Bondowoso ' +
            'di ujung timur Jawa, kawah dengan diameter sekitar 1 kilometer ini memiliki air danau ' +
            'berwarna toska dengan tingkat keasaman yang sangat tinggi (pH mendekati 0). Para penambang ' +
            'belerang yang disebut "penambang kawah" telah bekerja di sini selama puluhan tahun, ' +
            'memikul belerang padat seberat 70–90 kg setiap kali turun-naik. Kawah Ijen merupakan ' +
            'destinasi trekking dan wisata alam paling populer di Jawa Timur dan terkenal secara ' +
            'internasional.',
        lat: -8.058381,
        lng: 114.243299,
        province: 'Jawa Timur',
        city: 'Kabupaten Banyuwangi',
        link: 'https://id.wikipedia.org/wiki/Kawah_Ijen',
        imageCandidates: [
            ['Lac acide Kawah Ijen.JPG', 'Kawah Ijen.JPG'],
            ['Beautiful look at the Ijen volcano.jpg', 'Crater of Kawah Ijen volcano, East Java, Indonesia, 20220821 0611 9726.jpg'],
            ['Kawah Ijen (48140807781).jpg', 'Traditional Sulfur Miners at Kawah Ijen.jpg'],
        ],
    },
    {
        title: 'Jembatan Suramadu',
        description:
            'Jembatan Suramadu adalah jembatan terpanjang di Indonesia dengan panjang total 5.438 meter, ' +
            'menghubungkan Pulau Jawa (Surabaya) dengan Pulau Madura (Bangkalan) melintasi Selat Madura. ' +
            'Pembangunannya dimulai pada tahun 2003 dan diresmikan oleh Presiden Susilo Bambang ' +
            'Yudhoyono pada 10 Juni 2009 setelah melalui proses konstruksi yang panjang. Jembatan ' +
            'yang menggunakan desain cable-stayed pada bagian tengahnya ini merupakan pencapaian ' +
            'rekayasa teknik sipil terbesar Indonesia pada masanya, memangkas waktu perjalanan ' +
            'Surabaya–Bangkalan dari sekitar 30 menit dengan feri menjadi hanya 10 menit. Suramadu ' +
            'juga menjadi simbol pembangunan dan kemajuan wilayah Madura, mengakselerasi pertumbuhan ' +
            'ekonomi di Pulau Madura secara signifikan.',
        lat: -7.183790,
        lng: 112.774700,
        province: 'Jawa Timur',
        city: 'Kota Surabaya',
        link: 'https://id.wikipedia.org/wiki/Jembatan_Suramadu',
        imageCandidates: [
            ['Suramadu Bridge 5.JPG', 'Suramadu Bridge 4.JPG'],
            ['Jembatan Suramadu - panoramio.jpg', 'Jembatan Suramadu - Indonesia - panoramio.jpg'],
            ['Jembatan Menuju Dunia Baru (34268637756).jpg', 'Suramadu Bridge 5.JPG'],
        ],
    },
    {
        title: 'Candi Singosari',
        description:
            'Candi Singosari adalah candi Hindu-Buddha yang dibangun pada abad ke-13 Masehi sebagai ' +
            'tempat pemujaan dan pendharmaan Raja Kertanegara, raja terakhir Kerajaan Singasari yang ' +
            'wafat pada tahun 1292 akibat serangan Jayakatwang dari Kediri. Terletak di Kecamatan ' +
            'Singosari, Kabupaten Malang, candi setinggi sekitar 15 meter ini merupakan peninggalan ' +
            'Kerajaan Singasari yang paling penting dan masih berdiri cukup utuh. Arsitekturnya ' +
            'menampilkan gaya Jawa Timur dengan ornamen kala dan berbagai arca dewata yang halus ' +
            'ukirannya. Di sekitar candi masih terdapat beberapa arca Dwarapala (penjaga pintu) ' +
            'raksasa yang sangat megah.',
        lat: -7.887750,
        lng: 112.663910,
        province: 'Jawa Timur',
        city: 'Kabupaten Malang',
        link: 'https://id.wikipedia.org/wiki/Candi_Singosari',
        imageCandidates: [
            ['Candi Singosari A.JPG', 'Candi Singosari B.JPG'],
            ['Candi Singosari B.JPG', 'Candi Singosari A.JPG'],
            ['033 Jeru-Jeru Inscription, Singosari, 930 (39706583864).jpg', 'Candi Singosari B.JPG'],
        ],
    },
    {
        title: 'Museum Trowulan',
        description:
            'Museum Trowulan atau Museum Majapahit adalah museum arkeologi yang menyimpan ribuan ' +
            'artefak peninggalan Kerajaan Majapahit (1293–1527 M), terletak di Kecamatan Trowulan, ' +
            'Kabupaten Mojokerto, yang merupakan lokasi bekas ibu kota Kerajaan Majapahit. Museum ' +
            'ini menyimpan koleksi arca, keramik, gerabah, perhiasan emas, uang kuno, relief, dan ' +
            'berbagai benda budaya dari masa Majapahit yang merupakan kerajaan Hindu-Buddha terbesar ' +
            'di Nusantara. Di sekitar museum tersebar situs-situs arkeologi Majapahit yang masih ' +
            'aktif diekskavasi, seperti Candi Bajang Ratu, Candi Brahu, Kolam Segaran, dan Gerbang ' +
            'Wringin Lawang. Museum Trowulan menjadi pusat penelitian dan pelestarian warisan ' +
            'Majapahit yang sangat penting.',
        lat: -7.560139,
        lng: 112.380888,
        province: 'Jawa Timur',
        city: 'Kabupaten Mojokerto',
        link: 'https://id.wikipedia.org/wiki/Museum_Trowulan',
        imageCandidates: [
            ['032 Artefacts, Museum Mojopahit (40386063522).jpg', '042 Linga and Yoni, Museum Mojopahit (38618674520).jpg'],
            ['046 Airlangga as Visnu, riding Garuda, Museum Mojopahit (26544536398).jpg', '043 Relief, Woman and Houses, Museum Mojopahit (38618659350).jpg'],
            ['056 Kala Pillar, Museum Mojopahit (39718827474).jpg', '052 Relief, Houses near River, Museum Mojopahit (26558411028).jpg'],
        ],
    },
    {
        title: 'Candi Jabung',
        description:
            'Candi Jabung adalah candi Buddha yang dibangun pada tahun 1354 Masehi berdasarkan ' +
            'Prasasti Jabung, pada masa pemerintahan Raja Hayam Wuruk dari Kerajaan Majapahit, ' +
            'dan disebutkan dalam kitab Negarakertagama karya Mpu Prapanca sebagai "Bajrajinaparamitapura". ' +
            'Terletak di Desa Jabung, Kecamatan Paiton, Kabupaten Probolinggo, candi berbahan bata ' +
            'merah ini merupakan salah satu candi Majapahit yang paling terawat di Jawa Timur. ' +
            'Arsitekturnya yang silindris dengan menara meruncing memberikan kesan megah dan agung, ' +
            'dihiasi relief Jataka (kisah kehidupan sebelum Buddha Gautama) yang sangat indah di ' +
            'bagian kaki candi. Candi Jabung menjadi destinasi wisata sejarah penting di pesisir ' +
            'utara Jawa Timur.',
        lat: -7.735309,
        lng: 113.471753,
        province: 'Jawa Timur',
        city: 'Kabupaten Probolinggo',
        link: 'https://id.wikipedia.org/wiki/Candi_Jabung',
        imageCandidates: [
            ['Outer wall, Candi Jabung, Paiton, Probolinggo, East Java, 2017-09-14.jpg', 'Keagungan Candi Jabung.jpg'],
            ['Kala head, Candi Jabung, Paiton, Probolinggo, East Java, 2017-09-14 01.jpg', 'Kala head, Candi Jabung, Paiton, Probolinggo, East Java, 2017-09-14 02.jpg'],
            ['Menara sudut Candi Jabung.jpg', 'Outer wall, Candi Jabung, Paiton, Probolinggo, East Java, 2017-09-14.jpg'],
        ],
    },
    {
        title: 'Monumen Kapal Selam (Monkasel) Surabaya',
        description:
            'Monumen Kapal Selam atau Monkasel adalah museum unik berbentuk kapal selam sungguhan ' +
            'yang terletak di tepi Sungai Kalimas, Jalan Pemuda, Surabaya. Museum ini menggunakan ' +
            'KRI Pasopati 410, kapal selam kelas Whiskey buatan Uni Soviet yang pernah aktif bertugas ' +
            'di TNI Angkatan Laut Indonesia dari tahun 1962 hingga 1990. Kapal selam sepanjang 76,6 meter ' +
            'ini dibelah dan dipindahkan ke darat bagian demi bagian untuk dijadikan monumen dan ' +
            'museum militer maritim yang dibuka untuk umum pada tahun 1998. Pengunjung dapat masuk ' +
            'ke dalam kapal untuk melihat ruang kontrol, torpedo, mesin, dan berbagai peralatan ' +
            'navigasi asli, menjadikannya salah satu museum militer paling menarik di Indonesia.',
        lat: -7.265507,
        lng: 112.750161,
        province: 'Jawa Timur',
        city: 'Kota Surabaya',
        link: 'https://id.wikipedia.org/wiki/Monumen_Kapal_Selam',
        imageCandidates: [
            ['Submarine Monument Surabaya 1.JPG', 'Submarine Monument Surabaya 2.JPG'],
            ['Submarine Monument Surabaya 3.JPG', 'Submarine Monument Surabaya 5.JPG'],
            ['Submarine Monument Surabaya forward torpedo tubes.JPG', 'Bagian Dalam Monumen Kapal Selam (Monkasel) Surabaya.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Jawa Timur)');
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
