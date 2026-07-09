/**
 * scripts/seed-lampung-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Lampung Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-lampung-pins.js
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
// Pin data — 10 iconic & historic places in Lampung
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Taman Nasional Way Kambas',
        description:
            'Taman Nasional Way Kambas adalah kawasan konservasi alam seluas 1.300 km² yang terletak ' +
            'di Kabupaten Lampung Timur dan merupakan salah satu suaka gajah Sumatera tertua dan terpenting ' +
            'di Indonesia, didirikan pada tahun 1989. Di dalamnya terdapat Pusat Konservasi Gajah (PKG) ' +
            'yang menjadi pusat pelatihan dan rehabilitasi gajah Sumatera yang terancam punah. Taman nasional ' +
            'ini juga menjadi habitat badak Sumatera, harimau Sumatera, tapir, dan berbagai jenis burung ' +
            'endemik yang dilindungi. Way Kambas menjadi salah satu destinasi wisata alam dan konservasi ' +
            'paling penting di Provinsi Lampung dan seluruh Pulau Sumatra.',
        lat: -4.935931,
        lng: 105.756999,
        province: 'Lampung',
        city: 'Kabupaten Lampung Timur',
        link: 'https://id.wikipedia.org/wiki/Taman_Nasional_Way_Kambas',
        imageCandidates: [
            ['Taman_Nasional_Way_Kambas.jpg', 'Way_Kambas.JPG', 'Taman_Nasional_Way_Kambas_Lampung_Timur.jpg'],
            ['Gajah_sumatera.jpg', 'Gajah_Sumatera_Bermain_Bola.jpg', 'Anak_Gajah_bermain_di_Kolam.jpg'],
            ['Elephant_bath_time.jpg', 'Sumatran_Rhinoceros_Way_Kambas_2008.jpg', 'Pose_Gajah_di_Way_Kambas.jpg'],
        ],
    },
    {
        title: 'Gunung Anak Krakatau',
        description:
            'Gunung Anak Krakatau adalah gunung berapi aktif yang muncul dari kaldera bekas letusan ' +
            'dahsyat Krakatau tahun 1883, pertama kali terlihat muncul ke permukaan laut pada 29 Desember ' +
            '1927. Pulau vulkanik ini terletak di Selat Sunda, secara administratif masuk wilayah Kabupaten ' +
            'Lampung Selatan, dan terus tumbuh serta aktif meletus hingga saat ini. Pada Desember 2018, ' +
            'sebagian badan gunung runtuh ke laut dan memicu tsunami Selat Sunda yang mematikan, mengingatkan ' +
            'dunia akan kekuatan destruktif gunung berapi ini. Anak Krakatau merupakan objek penelitian ' +
            'geologi dan vulkanologi bertaraf internasional serta salah satu ikon alam paling dikenal ' +
            'di Indonesia.',
        lat: -6.097919,
        lng: 105.426364,
        province: 'Lampung',
        city: 'Kabupaten Lampung Selatan',
        link: 'https://id.wikipedia.org/wiki/Gunung_Anak_Krakatau',
        imageCandidates: [
            ['Anak_Krakatoa.jpg', 'Anak_Krakatau-1.JPG', 'Anak_Krakatau-2.JPG'],
            ['Gunung_Anak_Krakatau.jpg', 'Anak_Krakatau_(29988082317).jpg', 'Anak_krakatau_sebelum_tsunami.jpg'],
            ['Anak_Krakatau_Crater.JPG', 'Gugusan_Pulau_Anak_Krakatau.1._10042017.jpg', 'Uprising-mt_anak_krakatau.jpg'],
        ],
    },
    {
        title: 'Menara Siger',
        description:
            'Menara Siger adalah menara ikon Provinsi Lampung yang berdiri di atas Bukit Gamping, ' +
            'Kecamatan Bakauheni, Kabupaten Lampung Selatan, dengan ketinggian sekitar 110 meter di atas ' +
            'permukaan laut. Diresmikan pada 30 April 2008, menara ini berbentuk mahkota pengantin wanita ' +
            'Lampung (siger) dengan sembilan kerucut berwarna emas yang menjadi ciri khasnya. Menara ' +
            'Siger berfungsi sebagai titik nol Sumatera sekaligus penanda gerbang masuk daratan Sumatera ' +
            'dari Pelabuhan Bakauheni yang menghadap Selat Sunda. Di dalamnya terdapat ruang observasi ' +
            'yang menawarkan pemandangan laut dan aktivitas penyeberangan Jawa-Sumatra yang sibuk.',
        lat: -5.877000,
        lng: 105.692000,
        province: 'Lampung',
        city: 'Kabupaten Lampung Selatan',
        link: 'https://id.wikipedia.org/wiki/Menara_Siger',
        imageCandidates: [
            ['Port_of_Bakauheni_and_Siger_Tower.JPG', 'Menara_Siger.jpg', 'Bakauheni_Port_and_Siger_Tower.JPG'],
            ['Pelabuhan_Bakaheuni.jpeg', 'Menara_Siger.jpg', 'Port_of_Bakauheni_and_Siger_Tower.JPG'],
            ['Bakauheni_Port_and_Siger_Tower.JPG', 'Pelabuhan_Bakaheuni.jpeg', 'Menara_Siger.jpg'],
        ],
    },
    {
        title: 'Taman Nasional Bukit Barisan Selatan',
        description:
            'Taman Nasional Bukit Barisan Selatan (TNBBS) adalah kawasan konservasi hutan hujan tropis ' +
            'yang membentang di sepanjang punggung Pegunungan Bukit Barisan di ujung selatan Sumatera, ' +
            'meliputi wilayah Lampung, Bengkulu, dan Sumatera Selatan dengan total luas 356.800 hektare. ' +
            'Ditetapkan sebagai taman nasional pada tahun 1982 dan diakui sebagai Warisan Dunia UNESCO ' +
            'sejak 2004 sebagai bagian dari "Tropical Rainforest Heritage of Sumatra". TNBBS merupakan ' +
            'salah satu habitat terakhir yang tersisa bagi gajah, harimau, dan badak Sumatera dalam satu ' +
            'kawasan yang sama. Kawasan Suoh dengan danau-danau vulkanik seperti Danau Minyak dan Danau ' +
            'Asam menjadi daya tarik geowisata andalan taman nasional ini.',
        lat: -5.250000,
        lng: 104.166667,
        province: 'Lampung',
        city: 'Kabupaten Lampung Barat',
        link: 'https://id.wikipedia.org/wiki/Taman_Nasional_Bukit_Barisan_Selatan',
        imageCandidates: [
            ['Bukit_Besak.jpg', 'DJI_0762_danau_minyak_dan_danau_asam.jpg', 'Elephant_Patrol_at_Pemerihan_Bukit_Barisan_Selatan_National_Park_-_panoramio.jpg'],
            ['DJI_0847_kawah_nirwana_Suoh_TNBBS.jpg', 'Wisata_Suoh.jpg', 'Danau_Lebar_di_Pagi_Hari.jpg'],
            ['Riding_Elephant_at_Bukit_Barisan_Selatan_National_Park_-_panoramio.jpg', 'Kera_putih_endemik_pulau_sumatera.jpg', 'Pelangi_Horizontal_di_atas_Lembah_Bandar_Baru.jpg'],
        ],
    },
    {
        title: 'Pantai Tanjung Setia',
        description:
            'Pantai Tanjung Setia adalah pantai berselancar kelas dunia yang terletak di Kecamatan ' +
            'Pesisir Selatan, Kabupaten Pesisir Barat, Lampung, dan terkenal di kalangan peselancar ' +
            'internasional karena memiliki ombak barel yang konsisten dengan tinggi hingga 6 meter. ' +
            'Ombak yang dihasilkan oleh arus Samudra Hindia ini menjadikan Tanjung Setia setara dengan ' +
            'pantai-pantai selancar legendaris dunia, dengan Kompetisi Krui Pro secara rutin digelar ' +
            'di sini. Selain selancar, keindahan alam pantai yang masih alami dengan latar hutan Bukit ' +
            'Barisan Selatan menjadi daya tarik wisata alam yang luar biasa. Pantai ini merupakan ' +
            'kebanggaan Kabupaten Pesisir Barat dan destinasi surfing terbaik di Sumatra.',
        lat: -5.308799,
        lng: 103.992891,
        province: 'Lampung',
        city: 'Kabupaten Pesisir Barat',
        link: 'https://id.wikipedia.org/wiki/Tanjung_Setia,_Pesisir_Selatan,_Pesisir_Barat',
        imageCandidates: [
            ['Tanjung_Setia_-_panoramio.jpg', 'Pantai_Tanjung_Setia_Lampung.jpg', 'Tanjung_Setia_beach_Lampung.jpg'],
            ['Tanjung_Setia_surf_Lampung.jpg', 'Krui_Pro_surfing_Lampung.jpg', 'Tanjung_Setia_waves.jpg'],
            ['Pesisir_Barat_beach_Lampung.jpg', 'Tanjung_Setia_Indonesia.jpg', 'Surf_Tanjung_Setia.jpg'],
        ],
    },
    {
        title: 'Museum Negeri Lampung Ruwa Jurai',
        description:
            'Museum Negeri Lampung "Ruwa Jurai" adalah museum provinsi yang diresmikan pada 24 September ' +
            '1988, terletak di Jalan Z.A. Pagar Alam, Rajabasa, Kota Bandar Lampung. Museum ini ' +
            'menyimpan lebih dari 4.000 koleksi benda bersejarah dan budaya Lampung, mencakup artefak ' +
            'prasejarah, pakaian adat, perhiasan, peralatan tradisional, dan naskah kuno aksara Lampung. ' +
            'Nama "Ruwa Jurai" berasal dari filosofi masyarakat Lampung yang terdiri dari dua adat utama, ' +
            'yaitu Pepadun dan Saibatin. Museum ini merupakan pusat dokumentasi dan pelestarian kebudayaan ' +
            'Lampung yang paling komprehensif di provinsi ini.',
        lat: -5.376200,
        lng: 105.257800,
        province: 'Lampung',
        city: 'Kota Bandar Lampung',
        link: 'https://id.wikipedia.org/wiki/Museum_Negeri_Lampung',
        imageCandidates: [
            ['BERKUNJUNG_DI_MUSEUM_LAMPUNG.jpg', 'Museum_Lampung_Ruwa_Jurai.jpg', 'Museum_Negeri_Lampung.jpg'],
            ['Museum_Lampung_exterior.jpg', 'Museum_Ruwa_Jurai_Lampung.jpg', 'Museum_Lampung_collection.jpg'],
            ['Lampung_museum_interior.jpg', 'Museum_Lampung_Bandar.jpg', 'Ruwa_Jurai_museum_Lampung.jpg'],
        ],
    },
    {
        title: 'Masjid Agung Al-Furqon Bandar Lampung',
        description:
            'Masjid Agung Al-Furqon adalah masjid terbesar dan paling ikonik di Kota Bandar Lampung, ' +
            'berlokasi di Jalan Diponegoro, Kelurahan Gulak Galik, Kecamatan Teluk Betung Utara. Masjid ' +
            'ini memiliki arsitektur megah dengan kubah utama berwarna putih dan dua menara tinggi yang ' +
            'menjadi penanda cakrawala kota Bandar Lampung. Al-Furqon berfungsi sebagai pusat kegiatan ' +
            'keagamaan, pendidikan Islam, dan sosial kemasyarakatan bagi warga Kota Bandar Lampung. ' +
            'Kawasan masjid juga dilengkapi dengan aula serbaguna yang dapat menampung ribuan jamaah ' +
            'serta menjadi salah satu destinasi wisata religi utama di Lampung.',
        lat: -5.432700,
        lng: 105.262800,
        province: 'Lampung',
        city: 'Kota Bandar Lampung',
        link: 'https://id.wikipedia.org/wiki/Masjid_Al-Furqan_Bandar_Lampung',
        imageCandidates: [
            ['Masjid_Agung_Al-Furqon_Bandar_Lampung.jpg', 'Masjid_Al-Furqon_Bandar_Lampung.jpg', 'Masjid_Agung_Al-Furqon_Kota_Bandar_Lampung,_Lampung.jpg'],
            ['Masjid_Al-Furqon_Bandar_Lampung.jpg', 'Masjid_Agung_Al-Furqon_Bandar_Lampung.jpg', 'Masjid_Agung_Al-Furqon_Kota_Bandar_Lampung,_Lampung.jpg'],
            ['Masjid_Agung_Al-Furqon_Kota_Bandar_Lampung,_Lampung.jpg', 'Masjid_Agung_Al-Furqon_Bandar_Lampung.jpg', 'Masjid_Al-Furqon_Bandar_Lampung.jpg'],
        ],
    },
    {
        title: 'Danau Ranau',
        description:
            'Danau Ranau adalah danau terbesar kedua di Sumatera, terbentuk akibat aktivitas vulkanik ' +
            'dan gempa bumi ribuan tahun lalu, dengan luas permukaan sekitar 125,9 km² dan ketinggian ' +
            '540 meter di atas permukaan laut. Danau ini terletak di perbatasan antara Kabupaten Ogan ' +
            'Komering Ulu Selatan (Sumatera Selatan) dan Kabupaten Lampung Barat, dengan sisi barat daya ' +
            'masuk wilayah administratif Lampung. Gunung Seminung yang menjulang di tepian danau ' +
            'menambah keindahan panoramanya yang memukau dan sering menjadi latar fotografi alam. ' +
            'Danau Ranau merupakan destinasi wisata alam dan ekowisata andalan yang menawarkan ' +
            'pemandangan spektakuler, air panas, dan budaya lokal masyarakat Ranau.',
        lat: -4.867400,
        lng: 103.932261,
        province: 'Lampung',
        city: 'Kabupaten Lampung Barat',
        link: 'https://id.wikipedia.org/wiki/Danau_Ranau',
        imageCandidates: [
            ['Lake_Ranau.jpg', 'Gunung_dan_Danau.jpg', 'Cangkang_Kerang_Danau_Ranau.jpg'],
            ['Danau_Ranau_Lampung.jpg', 'Ranau_lake_Lampung.jpg', 'Danau_Ranau_panorama.jpg'],
            ['Danau_Ranau_Gunung_Seminung.jpg', 'Ranau_lake_sunset.jpg', 'Lake_Ranau_Indonesia.jpg'],
        ],
    },
    {
        title: 'Pantai Mutun',
        description:
            'Pantai Mutun adalah pantai wisata populer yang terletak di Kecamatan Padang Cermin, ' +
            'Kabupaten Pesawaran, Lampung, sekitar 20 kilometer dari pusat Kota Bandar Lampung. Pantai ' +
            'ini menawarkan pasir putih yang bersih, air laut yang jernih, dan pemandangan Pulau ' +
            'Tangkil yang cantik di depannya, dengan fasilitas wisata yang lengkap untuk keluarga. ' +
            'Dari Pantai Mutun, pengunjung dapat menyewa perahu untuk menyeberang ke Pulau Tangkil ' +
            'yang memiliki pantai berpasir putih yang masih sangat alami dan indah. Pantai Mutun ' +
            'menjadi salah satu destinasi wisata bahari favorit warga Bandar Lampung dan sekitarnya ' +
            'khususnya pada akhir pekan.',
        lat: -5.523889,
        lng: 105.162778,
        province: 'Lampung',
        city: 'Kabupaten Pesawaran',
        link: 'https://id.wikipedia.org/wiki/Padang_Cermin,_Pesawaran',
        imageCandidates: [
            ['Pantai_Mutun_Lampung.jpg', 'Pantai_Mutun_Pesawaran.jpg', 'Mutun_beach_Lampung.jpg'],
            ['Pulau_Tangkil_Lampung.jpg', 'Pantai_Mutun_Bandar_Lampung.jpg', 'Mutun_Pesawaran_beach.jpg'],
            ['Pantai_Mutun_Lampung_Indonesia.jpg', 'Pulau_Tangkil_Pesawaran.jpg', 'Pantai_Mutun_view.jpg'],
        ],
    },
    {
        title: 'Taman Wisata Lembah Hijau',
        description:
            'Taman Wisata Lembah Hijau adalah kawasan wisata alam dan budaya seluas sekitar 30 hektare ' +
            'yang terletak di Kecamatan Langkapura, Kota Bandar Lampung, menawarkan paduan antara ' +
            'wahana hiburan, kebun binatang mini, area outbound, dan pertunjukan seni budaya Lampung. ' +
            'Kawasan ini dirancang sebagai ruang hijau terpadu di tengah kota yang menyajikan flora ' +
            'dan fauna khas Lampung beserta kekayaan budaya tradisional daerah. Atraksi unggulan ' +
            'mencakup pertunjukan seni tari Lampung, arena berkuda, flying fox, dan berbagai fasilitas ' +
            'rekreasi keluarga yang menjadikannya destinasi wisata populer di Kota Bandar Lampung. ' +
            'Lembah Hijau juga menjadi pusat promosi pariwisata dan budaya Provinsi Lampung.',
        lat: -5.395556,
        lng: 105.246389,
        province: 'Lampung',
        city: 'Kota Bandar Lampung',
        link: 'https://id.wikipedia.org/wiki/Bandar_Lampung',
        imageCandidates: [
            ['Lembah_Hijau_Lampung.jpg', 'Taman_Lembah_Hijau_Bandar_Lampung.jpg', 'Lembah_Hijau_Bandar_Lampung.jpg'],
            ['Wisata_Lembah_Hijau_Lampung.jpg', 'Taman_Lembah_Hijau_Lampung.jpg', 'Lembah_Hijau_Lampung_park.jpg'],
            ['Lembah_Hijau_Langkapura.jpg', 'Taman_wisata_Lampung.jpg', 'Bandar_Lampung_taman_lembah.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Lampung)');
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
