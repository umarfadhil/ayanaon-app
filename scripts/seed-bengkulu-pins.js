/**
 * scripts/seed-bengkulu-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Bengkulu Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-bengkulu-pins.js
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
// Pin data — 10 iconic & historic places in Bengkulu
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Benteng Marlborough',
        description:
            'Benteng Marlborough adalah benteng kolonial Inggris yang dibangun antara tahun 1714 ' +
            'dan 1719 oleh East India Company di bawah pimpinan Gubernur Joseph Collet, dan merupakan ' +
            'benteng Inggris terbesar di Asia Tenggara. Benteng ini dibangun di atas bukit yang menghadap ' +
            'Samudra Hindia untuk mempertahankan kepentingan perdagangan lada Inggris di Bengkulu. ' +
            'Bangunannya berbentuk kura-kura dengan empat bastion di sudutnya, dilengkapi parit pertahanan, ' +
            'penjara, dan gudang amunisi. Saat ini benteng ini menjadi cagar budaya nasional dan salah ' +
            'satu daya tarik wisata sejarah utama di Provinsi Bengkulu.',
        lat: -3.786997,
        lng: 102.251741,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Benteng_Marlborough',
        imageCandidates: [
            ['Fort_Marlborough_-_Bengkulu.jpg', 'Fort_Marlborough_Bengkulu_main_gate.jpg', 'The_Gate_of_Fort_Marlborough.jpg'],
            ['Sukarno_interrogation_room,_Fort_Marlborough,_2015-04-19.jpg', 'Fort_Marlborough_Bengkulu_aerial.jpg', 'Panoramic_view_of_Bengkulu_Harbor,_2015-04-19.jpg'],
            ['Joseph_Constantine_Stadler_-_Fort_Marlborough,_Benkulen,_Sumatra,_1799_-_B1977.14.10968_-_Yale_Center_for_British_Art.jpg', 'KITLV_A218_-_Fort_Marlborough_te_Benkoelen_vanaf_de_zeezijde,_KITLV_37068.tiff', 'Fort_Marlborough_Bengkulu.jpg'],
        ],
    },
    {
        title: 'Rumah Pengasingan Bung Karno',
        description:
            'Rumah Pengasingan Bung Karno adalah rumah bersejarah di Jalan Soekarno-Hatta, Kota Bengkulu, ' +
            'tempat Presiden pertama Indonesia Soekarno menjalani masa pengasingan oleh pemerintah kolonial ' +
            'Belanda dari tahun 1938 hingga 1942. Rumah bergaya arsitektur perpaduan Eropa dan Tionghoa ' +
            'ini dulunya milik seorang pedagang Tionghoa yang kemudian disewa oleh Belanda untuk ' +
            'menempatkan Soekarno. Di dalam rumah terdapat berbagai benda peninggalan, termasuk ranjang ' +
            'besi, koleksi buku, dan kostum kelompok teater Monte Carlo yang dikelola Soekarno selama ' +
            'pengasingannya. Kini rumah ini menjadi museum yang terbuka untuk umum dan menjadi salah ' +
            'satu situs sejarah perjuangan kemerdekaan Indonesia yang paling penting.',
        lat: -3.793500,
        lng: 102.262200,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Rumah_Pengasingan_Bung_Karno',
        imageCandidates: [
            ['Rumah_Bung_Karno_di_Bengkulu.jpg', 'Rumah_Pengasingan_Bung_Karno_di_Kota_Bengkulu.jpg', 'Tampak_depan_rumah_pengasingan_Ir._Soekarno.jpg'],
            ['Rumah_pengasingan_Soekarno_Bengkulu_front.jpg', 'Rumah_Pengasingan_Sukarno_Bengkulu.jpg', 'Rumah_Fatmawati.jpg'],
            ['Soekarno_exile_house_Bengkulu_interior.jpg', 'Rumah_pengasingan_Bung_Karno_interior.jpg', 'Bengkulu_Soekarno_house_garden.jpg'],
        ],
    },
    {
        title: 'Masjid Jamik Bengkulu',
        description:
            'Masjid Jamik Bengkulu adalah masjid bersejarah yang terletak di Jalan Letjend Suprapto, ' +
            'Kota Bengkulu, dan merupakan salah satu masjid tertua serta paling ikonik di provinsi ini. ' +
            'Masjid ini memiliki keunikan arsitektur yang memadukan gaya Melayu dan Tionghoa, dengan ' +
            'atap bertingkat khas Asia yang membedakannya dari masjid kebanyakan. Soekarno turut berperan ' +
            'dalam merancang ulang masjid ini selama masa pengasingannya di Bengkulu antara 1938 dan 1942, ' +
            'sehingga masjid ini juga dikenal sebagai "Masjid Bung Karno." Masjid ini telah ditetapkan ' +
            'sebagai Cagar Budaya Nasional dan tetap menjadi pusat kegiatan keagamaan masyarakat Bengkulu.',
        lat: -3.792333,
        lng: 102.262222,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Masjid_Jamik_Bengkulu',
        imageCandidates: [
            ['Masjid_Jamik_-_Bengkulu.jpg', 'Masjid_Jamik_Bengkulu.jpg', 'Bengkulu_Jamik_Mosque_exterior.jpg'],
            ['Masjid_Jamik_Bengkulu_front.jpg', 'Masjid_Jamik_Bengkulu_interior.jpg', 'Masjid_Jamik_Kota_Bengkulu.jpg'],
            ['Bengkulu_Jamik_Mosque_aerial.jpg', 'Jamik_Mosque_Bengkulu_minaret.jpg', 'Masjid_Jamik_Bengkulu_night.jpg'],
        ],
    },
    {
        title: 'Danau Dendam Tak Sudah',
        description:
            'Danau Dendam Tak Sudah adalah danau alam seluas 68 hektare yang terletak di Kota Bengkulu ' +
            'dan dikelilingi kawasan cagar alam seluas 577 hektare yang ditetapkan sejak zaman Belanda ' +
            'pada tahun 1936. Nama danau ini berasal dari legenda rakyat setempat yang dikaitkan dengan ' +
            'kisah cinta yang tak kesampaian, meskipun versi lain menyebut nama itu berhubungan dengan ' +
            'proyek bendungan Belanda yang tidak pernah selesai. Danau ini terkenal sebagai habitat alami ' +
            'bunga kantong semar (Nepenthes gracilis) dan berbagai jenis burung endemik, menjadikannya ' +
            'destinasi ekowisata dan pengamatan burung yang populer. Kawasan perairan danau yang tenang ' +
            'juga sering dimanfaatkan untuk olahraga dayung dan rekreasi keluarga warga Kota Bengkulu.',
        lat: -3.841667,
        lng: 102.326944,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Danau_Dendam_Tak_Sudah',
        imageCandidates: [
            ['Danau_Dendam_Tak_Sudah.JPG', 'Danau_Dendam_Tak_Sudah_Bengkulu.jpg', 'Lake_Dendam_Tak_Sudah.jpg'],
            ['Dendam_Tak_Sudah_lake_view.jpg', 'Danau_Dendam_Tak_Sudah_panorama.jpg', 'Danau_Dendam_view_morning.jpg'],
            ['Danau_Dendam_Tak_Sudah_reflection.jpg', 'Nepenthes_Danau_Dendam.jpg', 'Bengkulu_Dendam_lake_boat.jpg'],
        ],
    },
    {
        title: 'Pantai Panjang',
        description:
            'Pantai Panjang adalah pantai berpasir putih yang membentang sepanjang kurang lebih 7 kilometer ' +
            'di sisi barat Kota Bengkulu, menjadikannya salah satu pantai terpanjang dan paling terkenal ' +
            'di Pulau Sumatra. Pantai ini menghadap langsung ke Samudra Hindia dan ditandai dengan deretan ' +
            'pohon cemara laut yang rindang di sepanjang garis pantai, memberikan suasana sejuk yang khas. ' +
            'Ombak yang relatif besar dan angin laut yang kencang menjadikan Pantai Panjang diminati untuk ' +
            'aktivitas selancar, namun tetap aman untuk rekreasi umum di kawasan pantai yang lebih tenang. ' +
            'Pantai ini berdekatan dengan sejumlah hotel berbintang, restoran seafood, dan fasilitas wisata ' +
            'lainnya yang mendukung pariwisata Kota Bengkulu.',
        lat: -3.835000,
        lng: 102.264000,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Pantai_Panjang',
        imageCandidates: [
            ['Pantai_Panjang.jpg', 'Pantai_panjang_casuarina.jpg', 'Pantai_Panjang_Bengkulu_beach.jpg'],
            ['Pantai_Panjang_Bengkulu_sunset.jpg', 'Panjang_Beach_Bengkulu.jpg', 'Bengkulu_Panjang_beach_coastline.jpg'],
            ['Pantai_Panjang_Bengkulu_shoreline.jpg', 'Pantai_panjang_cemara.jpg', 'Long_Beach_Bengkulu_Indonesia.jpg'],
        ],
    },
    {
        title: 'Monumen Thomas Parr',
        description:
            'Monumen Thomas Parr adalah tugu peringatan berbentuk segi delapan yang didirikan oleh ' +
            'pemerintah kolonial Inggris untuk mengenang Thomas Parr, Residen Bengkulu yang dibunuh pada ' +
            'tahun 1807 dalam sebuah pemberontakan rakyat melawan kekuasaan Inggris. Monumen ini terletak ' +
            'di Jalan Ahmad Yani, sekitar 170 meter arah tenggara dari Benteng Marlborough, di kawasan ' +
            'Kampung Cina, Kota Bengkulu. Struktur bangunannya merupakan peninggalan arsitektur kolonial ' +
            'Inggris yang langka dan masih terawat baik, meskipun kini berdiri di tengah keramaian kota. ' +
            'Monumen ini menjadi salah satu dari sedikit bukti fisik periode kekuasaan British East India ' +
            'Company di Bengkulu dan telah ditetapkan sebagai benda cagar budaya yang dilindungi.',
        lat: -3.790800,
        lng: 102.252700,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Monumen_Thomas_Parr',
        imageCandidates: [
            ['Thomas_Parr_Monument,_Bengkulu,_2015-04-19_01.jpg', 'Thomas_Parr_Monument,_Bengkulu,_2015-04-19_02.jpg', 'Thomas_Parr_Monument,_Bengkulu,_2015-04-19_03.jpg'],
            ['Thomas_Parr_Monument,_Bengkulu,_2015-04-19_04.jpg', 'Tugu_Thomas_Parr_Bengkulu.jpg', 'Thomas_Parr.png'],
            ['Monument_van_de_Engelse_resident_Thomas_Parr_te_Benkoelen,_KITLV_103959.tiff', 'Monument_van_de_Engelse_resident_Thomas_Parr_te_Benkoelen,_KITLV_105825.tiff', 'Monument_van_de_Engelse_resident_Thomas_Parr_te_Benkoelen,_KITLV_32351.tiff'],
        ],
    },
    {
        title: 'Taman Nasional Kerinci Seblat',
        description:
            'Taman Nasional Kerinci Seblat (TNKS) adalah kawasan konservasi terbesar di Sumatra dengan ' +
            'total luas 1.389.509 hektare, membentang di empat provinsi termasuk Bengkulu yang mencakup ' +
            'sekitar 310.910 hektare dari total kawasan. Kawasan ini telah ditetapkan sebagai Situs Warisan ' +
            'Dunia UNESCO pada tahun 2004 sebagai bagian dari Tropical Rainforest Heritage of Sumatra, ' +
            'dan merupakan habitat bagi satwa langka seperti harimau sumatra, badak sumatra, dan gajah ' +
            'sumatra. Di wilayah Bengkulu, taman nasional ini berbatasan dengan Kabupaten Kepahiang, ' +
            'Kabupaten Lebong, dan Kabupaten Seluma, serta mencakup hutan hujan tropis pegunungan yang ' +
            'kaya keanekaragaman hayati. Kawasan TNKS menjadi penyangga ekosistem penting dan sumber ' +
            'air bagi sungai-sungai besar yang mengaliri wilayah Bengkulu.',
        lat: -3.250000,
        lng: 102.000000,
        province: 'Bengkulu',
        city: 'Kabupaten Lebong',
        link: 'https://id.wikipedia.org/wiki/Taman_Nasional_Kerinci_Seblat',
        imageCandidates: [
            ['Kerinci_Seblat_National_Park_banner.jpg', 'Zonasi_taman_nasional_kerinci_seblat_2017.jpg', 'Kerinci_Seblat_National_Park_Sumatra.jpg'],
            ['Rafflesia_arnoldii_Kerinci_Seblat.jpg', 'Telun_Berasap_waterfall_Kerinci.jpg', 'Sumatran_tiger_Kerinci_Seblat.jpg'],
            ['TNKS_Bengkulu_rainforest.jpg', 'Kerinci_Seblat_forest_Bengkulu.jpg', 'Kerinci_Seblat_map.jpg'],
        ],
    },
    {
        title: 'Pulau Tikus',
        description:
            'Pulau Tikus adalah pulau kecil seluas sekitar 1,5 hektare yang terletak di Samudra Hindia, ' +
            'sekitar 10 kilometer di sebelah barat Kota Bengkulu, dikelilingi hamparan terumbu karang ' +
            'seluas kurang lebih 200 hektare yang kaya akan kehidupan laut. Pulau ini dapat dicapai ' +
            'dengan perahu motor dari Pantai Tapak Paderi dalam waktu sekitar 30-40 menit, dan menjadi ' +
            'destinasi favorit untuk snorkeling, diving, dan wisata bahari. Di pulau ini terdapat mercusuar ' +
            'tua peninggalan zaman kolonial yang pernah berfungsi sebagai pemandu kapal-kapal dagang di ' +
            'perairan Bengkulu, menjadikannya objek bernilai sejarah sekaligus alam. Ekosistem terumbu ' +
            'karang di sekitar Pulau Tikus termasuk dalam wilayah yang dilindungi dan menjadi bagian ' +
            'penting dari keanekaragaman hayati bahari Bengkulu.',
        lat: -3.730000,
        lng: 102.170000,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Pulau_Tikus,_Bengkulu',
        imageCandidates: [
            ['Pulau_Tikus_Bengkulu.jpg', 'Tikus_Island_Bengkulu_lighthouse.jpg', 'Pulau_Tikus_aerial_Bengkulu.jpg'],
            ['Tikus_Island_coral_reef_Bengkulu.jpg', 'Pulau_Tikus_beach_Bengkulu.jpg', 'Bengkulu_Tikus_island_snorkeling.jpg'],
            ['Pulau_Tikus_Bengkulu_panorama.jpg', 'Tikus_island_lighthouse_colonial.jpg', 'Pulau_Tikus_Indonesia_Bengkulu.jpg'],
        ],
    },
    {
        title: 'Kawasan Tapak Paderi',
        description:
            'Kawasan Tapak Paderi adalah situs bersejarah di tepi pantai Kota Bengkulu yang merupakan ' +
            'bekas pelabuhan utama pada masa kolonial Inggris dan salah satu pintu masuk perdagangan lada ' +
            'terpenting di Sumatra Barat pada abad ke-17 hingga ke-19. Kawasan ini dikembangkan oleh ' +
            'pemerintah Inggris termasuk pada masa pemerintahan Gubernur Jenderal Thomas Stamford Raffles ' +
            'sekitar tahun 1807, dan menjadi salah satu pusat administrasi dan perdagangan kolonial paling ' +
            'aktif di Bengkulu. Letaknya yang berdampingan langsung dengan Benteng Marlborough menjadikan ' +
            'Tapak Paderi sebagai kawasan cagar budaya yang menyimpan nilai sejarah tinggi, dengan pantai ' +
            'berpasir dan pemandangan Samudra Hindia yang menjadi daya tarik tambahan. Saat ini kawasan ' +
            'ini berfungsi sebagai destinasi wisata sejarah dan bahari yang terbuka untuk umum.',
        lat: -3.788500,
        lng: 102.252000,
        province: 'Bengkulu',
        city: 'Kota Bengkulu',
        link: 'https://id.wikipedia.org/wiki/Tapak_Paderi',
        imageCandidates: [
            ['Pantai_Tapak_Paderi_Bengkulu.jpg', 'Tapak_Paderi_beach_Bengkulu.jpg', 'Tapak_Paderi_Bengkulu_coast.jpg'],
            ['Kawasan_Tapak_Paderi_Bengkulu.jpg', 'Pantai_Tapak_Paderi_historical.jpg', 'Tapak_Paderi_port_Bengkulu.jpg'],
            ['Bengkulu_Tapak_Paderi_sunset.jpg', 'Pelabuhan_Tapak_Paderi_Bengkulu.jpg', 'Tapak_Paderi_Fort_Marlborough_view.jpg'],
        ],
    },
    {
        title: 'Bukit Kaba',
        description:
            'Bukit Kaba adalah gunung berapi aktif setinggi 1.938 meter di atas permukaan laut yang ' +
            'terletak di Kabupaten Rejang Lebong, Provinsi Bengkulu, dan merupakan salah satu gunung ' +
            'berapi paling aktif di Pulau Sumatra. Gunung ini memiliki tiga kawah aktif yang mengeluarkan ' +
            'asap belerang secara terus-menerus, menjadikannya objek wisata vulkanologi yang menarik bagi ' +
            'para pendaki dan peneliti. Jalur pendakian menuju puncak dapat ditempuh dalam waktu 2-3 jam ' +
            'dari pos pendakian di Desa Sumber Urip, melewati hutan heterogen yang kaya flora dan fauna. ' +
            'Dari puncak Bukit Kaba, pendaki dapat menikmati pemandangan panoramik kawah berasap, hamparan ' +
            'hutan Bengkulu, dan pemandangan Kota Curup yang memukau.',
        lat: -3.516667,
        lng: 102.618056,
        province: 'Bengkulu',
        city: 'Kabupaten Rejang Lebong',
        link: 'https://id.wikipedia.org/wiki/Bukit_Kaba',
        imageCandidates: [
            ['Bukit_Kaba.jpg', 'Bukit_Kaba_volcano_Bengkulu.jpg', 'Gunung_Bukit_Kaba.jpg'],
            ['Bukit_Kaba_crater.jpg', 'Bukit_Kaba_Rejang_Lebong.jpg', 'Volcano_Bukit_Kaba_Bengkulu.jpg'],
            ['Bukit_Kaba_summit.jpg', 'Kaba_volcano_Indonesia.jpg', 'Bukit_Kaba_Bengkulu_crater.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Bengkulu)');
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
