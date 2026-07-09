/**
 * scripts/seed-jateng-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Jawa Tengah Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-jateng-pins.js
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
// Pin data — 10 iconic & historic places in Jawa Tengah
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Candi Borobudur',
        description:
            'Candi Borobudur adalah candi Buddha terbesar di dunia dan salah satu monumen Buddha terbesar ' +
            'yang masih berdiri, dibangun pada abad ke-8 dan ke-9 Masehi pada masa Dinasti Syailendra. ' +
            'Terletak di Kecamatan Borobudur, Kabupaten Magelang, Jawa Tengah, candi megah ini terdiri ' +
            'dari sembilan tingkat berundak yang dihiasi 2.672 panel relief dan 504 arca Buddha. ' +
            'Puncaknya adalah stupa utama yang dikelilingi 72 stupa berlubang berisi arca Buddha. ' +
            'UNESCO menetapkan Borobudur sebagai Warisan Budaya Dunia sejak 1991, menjadikannya ' +
            'salah satu situs arkeologi dan religius paling penting di Asia dan destinasi wisata ' +
            'budaya terpopuler di Indonesia.',
        lat: -7.607930,
        lng: 110.203840,
        province: 'Jawa Tengah',
        city: 'Kabupaten Magelang',
        link: 'https://id.wikipedia.org/wiki/Candi_Borobudur',
        imageCandidates: [
            ['Borobudur-Nothwest-view.jpg', 'Borobudur temple panorama.jpg'],
            ['Borobudur-Temple-Park Indonesia Stupas-of-Borobudur-01.jpg', 'Borobudur-Temple-Park Indonesia Stupas-of-Borobudur-11.jpg'],
            ['Borobudur-Temple-Park Indonesia Reliefs-of-Borobudur-01.jpg', 'Borobudur Indonesia 13.jpg'],
        ],
    },
    {
        title: 'Lawang Sewu',
        description:
            'Lawang Sewu adalah bangunan bersejarah peninggalan kolonial Belanda yang dibangun antara ' +
            'tahun 1904 hingga 1907 sebagai kantor pusat Nederlandse-Indische Spoorweg Maatschappij (NIS), ' +
            'perusahaan kereta api swasta pertama di Hindia Belanda. Terletak di Jalan Pemuda, Semarang, ' +
            'nama "Lawang Sewu" berasal dari bahasa Jawa yang berarti "seribu pintu", merujuk pada ' +
            'banyaknya jendela tinggi yang menyerupai pintu pada bangunan bergaya Art Nouveau ini. ' +
            'Gedung tiga lantai yang megah ini menjadi ikon kota Semarang dan menyimpan sejarah ' +
            'panjang sebagai saksi perjuangan kemerdekaan Indonesia, termasuk pertempuran '  +
            'Lima Hari di Semarang pada Oktober 1945.',
        lat: -6.983930,
        lng: 110.410560,
        province: 'Jawa Tengah',
        city: 'Kota Semarang',
        link: 'https://id.wikipedia.org/wiki/Lawang_Sewu',
        imageCandidates: [
            ['Lawang Sewu Semarang Indonesia 1.jpg', 'Lawang Sewu in Semarang City.jpg'],
            ['Lawang Sewu (Seribu Tiang).jpg', 'Lawang sewu semarang.jpg'],
            ['Lawang Sewu A building hallway.jpg', 'Lawang Sewu Semarang cropped.jpg'],
        ],
    },
    {
        title: 'Kota Lama Semarang',
        description:
            'Kota Lama Semarang adalah kawasan bersejarah seluas sekitar 31 hektare di pusat Kota ' +
            'Semarang yang menyimpan ratusan bangunan bergaya arsitektur Eropa, khususnya Belanda, ' +
            'dari abad ke-17 hingga awal abad ke-20. Dijuluki "Little Netherland" karena kepadatan ' +
            'bangunan kolonialnya yang masih terawat, kawasan ini dulunya merupakan pusat perdagangan ' +
            'dan pemerintahan Hindia Belanda di wilayah pantai utara Jawa. Bangunan ikoniknya antara ' +
            'lain Gereja Blenduk (GPIB Immanuel), Gedung Marabunta, dan berbagai gudang tua di ' +
            'tepi Kali Semarang. Sejak 2023, Kota Lama Semarang resmi diusulkan sebagai Warisan ' +
            'Budaya Dunia UNESCO.',
        lat: -6.968017,
        lng: 110.427877,
        province: 'Jawa Tengah',
        city: 'Kota Semarang',
        link: 'https://id.wikipedia.org/wiki/Kota_Lama_Semarang',
        imageCandidates: [
            ['Kota Lama Semarang.jpg', 'Kota Lama Semarang 1.jpg'],
            ['Kota Lama Semarang 4.jpg', 'Kota Lama Semarang 5.jpg'],
            ['Bangunan Kompleks Kota Lama Semarang 01.jpg', 'Kota Lama, Semarang, Central Java.jpg'],
        ],
    },
    {
        title: 'Masjid Agung Demak',
        description:
            'Masjid Agung Demak adalah salah satu masjid tertua di Indonesia dan diyakini sebagai ' +
            'masjid pertama di Pulau Jawa, dibangun pada abad ke-15 oleh Wali Songo — sembilan ulama ' +
            'penyebar Islam di Nusantara — pada masa Kesultanan Demak Bintoro yang merupakan kerajaan ' +
            'Islam pertama di Jawa. Terletak di alun-alun Kota Demak, masjid ini memiliki arsitektur ' +
            'khas Jawa dengan atap tumpang tiga yang melambangkan Iman, Islam, dan Ihsan. Salah satu ' +
            'tiangnya, yang disebut "saka tatal", konon dibuat dari pecahan kayu oleh Sunan Kalijaga. ' +
            'Masjid Agung Demak menjadi pusat ziarah dan wisata religi paling penting di Jawa Tengah.',
        lat: -6.894730,
        lng: 110.637390,
        province: 'Jawa Tengah',
        city: 'Kabupaten Demak',
        link: 'https://id.wikipedia.org/wiki/Masjid_Agung_Demak',
        imageCandidates: [
            ['Masjid Agung Demak.jpg', 'Masjid Agung Demak 2.jpg'],
            ['Masjid Agung Demak Kab.Demak Prop.Jateng Indonesia.jpg', 'Masjid Agung Demak DiKab.Demak Jateng Indonesia.jpg'],
            ['Sisi Depan Serambi Masjid Agung Demak Kab.Demak Prop.Jateng Indonesia.jpg', 'Masjid Agung Demak Di Kab.Demak Jateng Indonesia.jpg'],
        ],
    },
    {
        title: 'Keraton Kasunanan Surakarta',
        description:
            'Keraton Kasunanan Surakarta Hadiningrat adalah istana resmi Kesunanan Surakarta, salah ' +
            'satu dari dua penerus Kesultanan Mataram yang terbagi pada tahun 1755 melalui Perjanjian ' +
            'Giyanti. Dibangun pada tahun 1744–1745 oleh Susuhunan Pakubuwono II di tepi Sungai Bengawan ' +
            'Solo, keraton ini merupakan contoh arsitektur Jawa klasik yang megah dengan pendopo agung, ' +
            'sasana sewaka, dan berbagai bangunan bersejarah yang menggambarkan kejayaan budaya Jawa. ' +
            'Di dalamnya tersimpan koleksi pusaka kerajaan, kereta kencana, gamelan sakral, dan berbagai ' +
            'artefak budaya Jawa yang bernilai tinggi. Keraton ini masih dihuni dan berfungsi sebagai ' +
            'pusat pelestarian budaya Jawa hingga saat ini.',
        lat: -7.577490,
        lng: 110.827970,
        province: 'Jawa Tengah',
        city: 'Kota Surakarta',
        link: 'https://id.wikipedia.org/wiki/Keraton_Surakarta_Hadiningrat',
        imageCandidates: [
            ['Keraton Kasunanan Surakarta Hadiningrat.jpg', 'Sasana Sewaka Keraton Surakarta.JPG'],
            ['Pendhapa Sasana Sewaka Keraton Surakarta 2017.jpg', 'Keraton Kasunanan Surakarta Hadiningrat.jpg'],
            ['Sasana Sewaka Keraton Surakarta.JPG', 'Pendhapa Sasana Sewaka Keraton Surakarta 2017.jpg'],
        ],
    },
    {
        title: 'Pura Mangkunegaran',
        description:
            'Pura Mangkunegaran adalah istana Kadipaten Mangkunegaran, salah satu dari empat istana ' +
            'kerajaan Jawa yang merupakan hasil pemisahan dari Kesultanan Mataram. Didirikan pada ' +
            'tahun 1757 oleh Raden Mas Said (Mangkunegara I) setelah Perjanjian Salatiga, istana ini ' +
            'berdiri megah di pusat Kota Surakarta dan dikenal memiliki pendopo yang sangat luas — ' +
            'salah satu pendopo terbesar di Jawa — dengan atap berornamen batik dan koleksi wayang ' +
            'serta gamelan yang bernilai seni tinggi. Museum Mangkunegaran di dalamnya menyimpan ' +
            'koleksi perhiasan, kostum tari, topeng, senjata, dan artefak Jawa yang kaya. Pura ' +
            'Mangkunegaran masih aktif berfungsi sebagai pusat seni budaya dan kediaman resmi ' +
            'Mangkunegara X.',
        lat: -7.566325,
        lng: 110.822994,
        province: 'Jawa Tengah',
        city: 'Kota Surakarta',
        link: 'https://id.wikipedia.org/wiki/Pura_Mangkunegaran',
        imageCandidates: [
            ['Grand Pendopo, Mangkunegaran Palace.jpg', 'Pendopo Mangkunegaran Surakarta.jpg'],
            ['Entrance to Pendopo, Mangkunegaran Palace, Surakarta, 2016-10-09.jpg', 'Grand Pendopo, Mangkunegaran Palace.jpg'],
            ['Taman Dalem Pura Mangkunegaran Solo.jpg', 'Spot Foto Taman Pura Mangkunegaran Solo.jpg'],
        ],
    },
    {
        title: 'Situs Sangiran',
        description:
            'Situs Sangiran adalah situs arkeologi dan paleoantropologi terpenting di Asia Tenggara, ' +
            'terletak di Kabupaten Sragen dan Karanganyar, Jawa Tengah, dengan luas sekitar 59 km². ' +
            'Di situs ini ditemukan fosil-fosil manusia purba Homo erectus (Pithecanthropus) dan ' +
            'berbagai fauna Pleistosen yang berusia antara 1,8 juta hingga 200.000 tahun lalu, ' +
            'menjadikannya salah satu sumber temuan fosil manusia purba paling kaya di dunia. ' +
            'UNESCO menetapkan Sangiran sebagai Warisan Budaya Dunia pada tahun 1996. Museum ' +
            'Sangiran yang modern menyajikan koleksi ribuan fosil, rekonstruksi kehidupan prasejarah, ' +
            'dan informasi ilmiah tentang evolusi manusia di Nusantara.',
        lat: -7.453310,
        lng: 110.834350,
        province: 'Jawa Tengah',
        city: 'Kabupaten Sragen',
        link: 'https://id.wikipedia.org/wiki/Situs_Sangiran',
        imageCandidates: [
            ['Museum Sangiran.jpg', 'Museum Purbakala Sangiran 1.JPG'],
            ['Museum Purba Krikilan Sangiran.jpg', 'Sangiran museum.jpg'],
            ['Museum Purbakala Sangiran 2.JPG', 'Museum Sangiran.jpg'],
        ],
    },
    {
        title: 'Candi Sukuh',
        description:
            'Candi Sukuh adalah candi Hindu bergaya unik yang terletak di lereng barat Gunung Lawu, ' +
            'Kecamatan Ngargoyoso, Kabupaten Karanganyar, pada ketinggian sekitar 910 meter di atas ' +
            'permukaan laut. Dibangun pada abad ke-15 Masehi di masa akhir Kerajaan Majapahit, candi ' +
            'ini memiliki bentuk piramida berundak yang sangat berbeda dari candi-candi Jawa pada ' +
            'umumnya, dengan orientasi menghadap barat serta relief dan arca yang sarat simbolisme ' +
            'kesuburan dan mistisme Jawa-Hindu. Keunikan arsitektur dan ikonografinya menjadikan ' +
            'Candi Sukuh sebagai salah satu candi paling misterius dan menarik di Indonesia. Lokasinya ' +
            'yang tinggi di lereng gunung memberikan pemandangan alam yang spektakuler.',
        lat: -7.627400,
        lng: 111.131180,
        province: 'Jawa Tengah',
        city: 'Kabupaten Karanganyar',
        link: 'https://id.wikipedia.org/wiki/Candi_Sukuh',
        imageCandidates: [
            ['Candi Sukuh.jpg', 'Platform, Candi Sukuh 1226.jpg'],
            ['Laborers at Candi Sukuh, 2016-10-13.jpg', 'Statue at Sukuh Temple, 2016-10-13 06.jpg'],
            ['Relief at Sukuh Temple, 2016-10-13 05.jpg', 'Candi Sukuh.jpg'],
        ],
    },
    {
        title: 'Benteng Pendem Cilacap',
        description:
            'Benteng Pendem Cilacap (Küstbatterij op de Landtong te Tjilatjap) adalah benteng pertahanan ' +
            'kolonial Belanda yang dibangun antara tahun 1861 dan 1879 di ujung tanjung Cilacap, ' +
            'menghadap Samudra Hindia. Benteng ini dibangun sebagai pertahanan laut dan pangkalan ' +
            'militer strategis di selatan Pulau Jawa, dengan sistem terowongan bawah tanah, ruang ' +
            'amunisi, barak prajurit, dan bastion yang didesain untuk menghadapi serangan dari laut. ' +
            'Nama "Pendem" berasal dari kata Jawa yang berarti "terpendam", karena sebagian besar ' +
            'bangunan ini terkubur di bawah tanah. Benteng seluas 10,5 hektare ini kini menjadi ' +
            'objek wisata sejarah utama di Cilacap dan salah satu benteng kolonial terlengkap ' +
            'yang masih tersisa di Indonesia.',
        lat: -7.749210,
        lng: 109.017000,
        province: 'Jawa Tengah',
        city: 'Kabupaten Cilacap',
        link: 'https://id.wikipedia.org/wiki/Benteng_Pendem_Cilacap',
        imageCandidates: [
            ['Barracks, Benteng Pendem, Cilacap 2015-03-21.jpg', 'Entrance to fortifications, Benteng Pendem, Cilacap 2015-03-21.jpg'],
            ['Benteng Pendem Cilacap fortress.jpg', 'Benteng Pendem Cilacap panorama.jpg'],
            ['Benteng Pendem Cilacap entrance.jpg', 'Benteng Pendem Cilacap canal.jpg'],
        ],
    },
    {
        title: 'Candi Gedong Songo',
        description:
            'Candi Gedong Songo adalah kompleks candi Hindu bergaya Jawa Tengah Kuno yang terletak ' +
            'di lereng Gunung Ungaran, Kecamatan Bandungan, Kabupaten Semarang, pada ketinggian ' +
            'sekitar 1.200 meter di atas permukaan laut. Dibangun pada abad ke-8 hingga ke-9 Masehi ' +
            'pada masa Dinasti Syailendra, kompleks ini terdiri dari sembilan kelompok candi (gedong ' +
            'songo berarti "sembilan bangunan" dalam bahasa Jawa) yang tersebar di lereng bukit ' +
            'yang hijau. Pemandangan spektakuler pegunungan Jawa Tengah, sumber air panas alami, ' +
            'dan udara sejuk pegunungan menjadikan Gedong Songo sebagai salah satu destinasi wisata ' +
            'budaya dan alam paling populer di Jawa Tengah.',
        lat: -7.208472,
        lng: 110.341889,
        province: 'Jawa Tengah',
        city: 'Kabupaten Semarang',
        link: 'https://id.wikipedia.org/wiki/Candi_Gedong_Songo',
        imageCandidates: [
            ['Gedong songo.jpg', 'Candi Gedong Songo I, 2014-06-16.jpg'],
            ['Larger Shiva Temple, Gedong Songo III, 1210.jpg', 'Gedong Songo III, 1211.jpg'],
            ['Gedong Songo IV, 1217.jpg', 'Gedong Songo V, 1218.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Jawa Tengah)');
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
