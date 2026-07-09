/**
 * scripts/seed-ntb-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Nusa Tenggara Barat (NTB) Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-ntb-pins.js
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
// Pin data — 10 iconic & historic places in Nusa Tenggara Barat
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Gunung Rinjani',
        description:
            'Gunung Rinjani adalah gunung berapi tertinggi kedua di Indonesia dengan ketinggian 3.726 ' +
            'meter di atas permukaan laut, terletak di Pulau Lombok, Nusa Tenggara Barat. Gunung ini ' +
            'merupakan gunung yang paling disucikan oleh masyarakat Sasak, Bali, dan Hindu Lombok, dan ' +
            'dipercaya sebagai tempat bersemayamnya roh leluhur dan dewa. Di kaldera puncaknya terdapat ' +
            'Danau Segara Anak, danau kawah berbentuk bulan sabit pada ketinggian 2.008 meter yang ' +
            'dianggap sakral dan menjadi tujuan ziarah bagi penganut agama Hindu dan Wektu Telu. Taman ' +
            'Nasional Gunung Rinjani yang melingkupinya telah diakui UNESCO sebagai Global Geopark dan ' +
            'menjadi salah satu destinasi pendakian paling populer di Asia Tenggara.',
        lat: -8.410189,
        lng: 116.458329,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Lombok Timur',
        link: 'https://id.wikipedia.org/wiki/Gunung_Rinjani',
        imageCandidates: [
            ['Gunung_Rinjani_dan_danau_Segara_Anak.jpg', 'Rinjani_1994_cropped.PNG', 'Mount_Rinjani_Lombok.jpg'],
            ['Rinjani_from_Baru_Jari.jpg', 'Gunung_Rinjani_Lombok.jpg', 'Rinjani_volcano_Lombok.jpg'],
            ['Lombok_Rinjani_Segara_Anak.jpg', 'Segara_Anak_lake_Rinjani.jpg', 'Puncak_Rinjani_NTB.jpg'],
        ],
    },
    {
        title: 'Mayura Water Palace',
        description:
            'Taman Mayura atau Mayura Water Palace adalah taman air kerajaan bersejarah yang dibangun ' +
            'pada tahun 1744 oleh Raja Karangasem dari Bali yang saat itu menguasai Lombok Barat. Taman ' +
            'ini merupakan peninggalan budaya Bali di Lombok yang paling megah, dan menjadi tempat ' +
            'pertemuan dan perayaan kerajaan pada masa kejayaannya. Atraksi utamanya adalah Bale Kambang, ' +
            'sebuah paviliun terapung di tengah kolam besar berisi ikan-ikan hias, yang dahulu berfungsi ' +
            'sebagai ruang pertemuan raja dan tempat pengadilan kerajaan. Taman Mayura juga menyaksikan ' +
            'Pertempuran Cakranegara tahun 1894 antara pasukan kerajaan Lombok dan ekspedisi militer ' +
            'Belanda, dan kini menjadi situs warisan sejarah yang dilindungi.',
        lat: -8.594194,
        lng: 116.104750,
        province: 'Nusa Tenggara Barat',
        city: 'Kota Mataram',
        link: 'https://id.wikipedia.org/wiki/Taman_Mayura',
        imageCandidates: [
            ['Mayura_Water_Palace_(6215204739).jpg', 'COLLECTIE_TROPENMUSEUM_De_Bale_Kembang_in_het_Mayura_waterpaleis_te_Tjakranegara_TMnr_60017207.jpg', 'Taman_Mayura_Lombok.jpg'],
            ['Mayura_Water_Palace_Mataram.jpg', 'Taman_Mayura_Cakranegara.jpg', 'Mayura_Palace_Lombok.jpg'],
            ['Bale_Kambang_Mayura_Lombok.jpg', 'Mayura_water_palace_Cakranegara.jpg', 'Taman_Mayura_kolam.jpg'],
        ],
    },
    {
        title: 'Pura Lingsar',
        description:
            'Pura Lingsar adalah kompleks pura unik yang dibangun pada tahun 1714 oleh Raja Anak Agung ' +
            'Ngurah dari Kerajaan Karangasem di Lombok Barat, dan merupakan simbol kerukunan antara ' +
            'pemeluk agama Hindu Bali dan Islam Wektu Telu (Islam tradisional Lombok). Kompleks ini ' +
            'dibagi menjadi dua bagian utama: Pura Hindu (Gaduh) di tingkat lebih tinggi, dan Kemaliq ' +
            'di bawahnya yang digunakan oleh penganut Wektu Telu untuk ritual mereka. Di dalam Kemaliq ' +
            'terdapat kolam keramat yang dihuni belut suci yang dipercaya membawa keberuntungan bagi ' +
            'siapa pun yang berhasil menawarkan telur kepada mereka. Setiap tahun pura ini menjadi ' +
            'lokasi perayaan festival Perang Topat, di mana umat Hindu dan Muslim saling melempar ' +
            'ketupat sebagai simbol persaudaraan dan doa untuk kesuburan.',
        lat: -8.575164,
        lng: 116.180463,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Lombok Barat',
        link: 'https://id.wikipedia.org/wiki/Pura_Lingsar',
        imageCandidates: [
            ['COLLECTIE_TROPENMUSEUM_De_Poera_Zinsar_TMnr_60012475.jpg', 'COLLECTIE_TROPENMUSEUM_Bassin_in_een_tempel_waar_heilige_palingen_worden_vereerd_Lingsar_TMnr_10029688.jpg', 'Pura_Lingsar_Lombok.jpg'],
            ['Lingsar_temple_Lombok.jpg', 'Pura_Lingsar_West_Lombok.jpg', 'Lingsar_Lombok_Indonesia.jpg'],
            ['Pura_Lingsar_holy_eels.jpg', 'Lingsar_sacred_pool.jpg', 'Lingsar_temple_complex.jpg'],
        ],
    },
    {
        title: 'Istana Dalam Loka',
        description:
            'Istana Dalam Loka atau disebut juga "Istana Tua" adalah istana kesultanan bersejarah milik ' +
            'Kesultanan Sumbawa yang terletak di pusat Kota Sumbawa Besar, Kabupaten Sumbawa, Nusa ' +
            'Tenggara Barat. Istana yang dibangun pada tahun 1885 oleh Sultan Muhammad Jalaluddin III ' +
            'ini merupakan bangunan berarsitektur kayu tradisional Sumbawa yang berdiri di atas 99 tiang ' +
            'penyangga, melambangkan 99 nama Allah (Asmaul Husna) dalam ajaran Islam. Dengan tinggi ' +
            'bangunan sekitar 7 meter dari tanah dan luas sekitar 904 meter persegi, istana ini ' +
            'merupakan salah satu bangunan kayu tradisional terbesar yang masih tersisa di Indonesia. ' +
            'Kini Istana Dalam Loka difungsikan sebagai museum yang menyimpan berbagai koleksi benda ' +
            'pusaka kerajaan dan artefak budaya Sumbawa.',
        lat: -8.488000,
        lng: 117.413000,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Sumbawa',
        link: 'https://id.wikipedia.org/wiki/Istana_Dalam_Loka',
        imageCandidates: [
            ['Istana_Dalam_Loka_Sumbawa.jpg', 'Dalam_Loka_Sumbawa_NTB.jpg', 'Sumbawa_palace.jpg'],
            ['Dalam_Loka_palace_stilts.jpg', 'Istana_Dalam_Loka.jpg', 'Sumbawa_Besar_palace.jpg'],
            ['Dalam_Loka_traditional_architecture.jpg', 'Sultan_palace_Sumbawa.jpg', 'Istana_Sumbawa_Besar.jpg'],
        ],
    },
    {
        title: 'Museum Asi Mbojo (Istana Kesultanan Bima)',
        description:
            'Museum Asi Mbojo adalah bekas istana Kesultanan Bima yang kini difungsikan sebagai museum ' +
            'budaya dan sejarah di Kota Bima, Nusa Tenggara Barat. Istana yang dibangun pada tahun 1927 ' +
            'ini merupakan peninggalan bersejarah Kesultanan Bima, salah satu kesultanan Islam terpenting ' +
            'di Nusa Tenggara yang pernah berkuasa selama berabad-abad. Bangunan bergaya campuran antara ' +
            'arsitektur tradisional Bima dan kolonial Eropa ini menyimpan berbagai koleksi berharga ' +
            'seperti pakaian adat kerajaan, perhiasan, senjata pusaka, naskah kuno, keris, dan foto-foto ' +
            'para sultan Bima. Museum ini merupakan pusat pelestarian kebudayaan masyarakat Mbojo (Bima) ' +
            'dan menjadi destinasi wisata sejarah paling penting di Kota Bima.',
        lat: -8.454067,
        lng: 118.727289,
        province: 'Nusa Tenggara Barat',
        city: 'Kota Bima',
        link: 'https://id.wikipedia.org/wiki/Museum_Asi_Mbojo',
        imageCandidates: [
            ['Museum_Asi_Mbojo_Bima.jpg', 'Istana_Kesultanan_Bima.jpg', 'Asi_Mbojo_Bima_NTB.jpg'],
            ['Museum_Asi_Mbojo.jpg', 'Bima_palace_museum.jpg', 'Kesultanan_Bima_istana.jpg'],
            ['Asi_Mbojo_Museum_NTB.jpg', 'Bima_sultanate_palace.jpg', 'Museum_Bima_NTB.jpg'],
        ],
    },
    {
        title: 'Gili Trawangan',
        description:
            'Gili Trawangan adalah pulau terbesar dari gugusan tiga Gili (Trawangan, Meno, Air) yang ' +
            'terletak di lepas pantai barat laut Pulau Lombok, Kabupaten Lombok Utara, Nusa Tenggara ' +
            'Barat. Pulau ini terkenal karena tidak ada kendaraan bermotor, digantikan oleh cidomo ' +
            '(kereta kuda) dan sepeda sebagai transportasi utama, serta kehidupan bawah laut yang ' +
            'sangat kaya dengan terumbu karang, penyu hijau, dan berbagai ikan tropis yang menjadikannya ' +
            'surga menyelam dan snorkeling kelas dunia. Gili Trawangan memiliki panjang sekitar 3 km ' +
            'dan lebar 2 km, dikelilingi pantai berpasir putih yang bening, dan menawarkan pemandangan ' +
            'Gunung Rinjani yang dramatis sebagai latar belakangnya. Gili Trawangan sering disebut sebagai ' +
            'pulau terbaik di Indonesia oleh berbagai majalah wisata internasional.',
        lat: -8.350785,
        lng: 116.038628,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Lombok Utara',
        link: 'https://id.wikipedia.org/wiki/Gili_Trawangan',
        imageCandidates: [
            ['Lighthouse_Gili_Trawangan.JPG', 'Gili_Trawangan_beach_4.JPG', 'Main_street_Gili_Trawangan.JPG'],
            ['Gili_Trawangan_Lombok.jpg', 'Gili_Islands_Lombok.jpg', 'Gili_Trawangan_Indonesia.jpg'],
            ['Gili_Trawangan_beach.jpg', 'Gili_Trawangan_sunset.jpg', 'Gili_Trawangan_NTB.jpg'],
        ],
    },
    {
        title: 'Desa Sade',
        description:
            'Desa Sade adalah desa adat suku Sasak yang terletak di Dusun Sade, Desa Rambitan, Kecamatan ' +
            'Pujut, Kabupaten Lombok Tengah, Nusa Tenggara Barat, dan merupakan salah satu desa adat ' +
            'yang paling autentik dan terpelihara di Pulau Lombok. Desa ini dihuni oleh ratusan jiwa ' +
            'yang masih mempertahankan tradisi leluhur suku Sasak, termasuk rumah tradisional yang ' +
            'lantainya dilumuri dengan kotoran kerbau yang dipercaya mengusir nyamuk dan membuat lantai ' +
            'menjadi bersih dan tahan lama. Kerajinan tenun ikat kain khas Lombok dengan motif-motif ' +
            'tradisional Sasak yang dikerjakan oleh para wanita desa masih menjadi produksi utama ' +
            'sehari-hari dan dijual kepada wisatawan sebagai oleh-oleh otentik.',
        lat: -8.839308,
        lng: 116.291987,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Lombok Tengah',
        link: 'https://id.wikipedia.org/wiki/Sade,_Rambitan,_Pujut,_Lombok_Tengah',
        imageCandidates: [
            ['Traditional_Sasak_Village_Sade_houses.JPG', 'Rice_barn_Traditional_Sasak_Village_Sade.JPG', 'Tenun_Ikat_Lombok_Traditional_Sasak_Village_Sade.JPG'],
            ['Desa_Sade_Lombok.jpg', 'Sasak_village_Sade_Lombok.jpg', 'Sade_traditional_village_NTB.jpg'],
            ['Sasak_traditional_house_Lombok.jpg', 'Desa_adat_Sade_Lombok.jpg', 'Sade_Lombok_weaving.jpg'],
        ],
    },
    {
        title: 'Pantai Tangsi (Pink Beach Lombok)',
        description:
            'Pantai Tangsi atau Pink Beach Lombok adalah pantai dengan pasir berwarna merah muda yang ' +
            'langka dan unik, terletak di Desa Sekaroh, Kecamatan Jerowaru, Kabupaten Lombok Timur, ' +
            'Nusa Tenggara Barat. Warna merah muda pasir pantai ini berasal dari campuran butiran karang ' +
            'merah (Foraminifera) yang tumbuh di kedalaman perairan sekitar pantai dan terbawa arus ' +
            'ke pesisir. Pantai ini termasuk salah satu dari hanya tujuh pantai berpasir merah muda ' +
            'yang ada di seluruh dunia, menjadikannya salah satu keajaiban alam paling langka dan ' +
            'istimewa di Indonesia. Perairan laut di sekitar Pantai Tangsi memiliki kejernihan yang ' +
            'luar biasa dengan terumbu karang yang masih sangat terjaga, menjadikannya surga bagi ' +
            'penyelam dan pecinta snorkeling.',
        lat: -8.853720,
        lng: 116.562593,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Lombok Timur',
        link: 'https://id.wikipedia.org/wiki/Pantai_Tangsi',
        imageCandidates: [
            ['Pantai_Tangsi_Pink_Beach_Lombok.jpg', 'Pink_Beach_Lombok_Indonesia.jpg', 'Tangsi_Beach_Lombok.jpg'],
            ['Pink_beach_Lombok_NTB.jpg', 'Pantai_pink_Lombok.jpg', 'Pantai_Tangsi_Lombok_Timur.jpg'],
            ['Pink_sand_beach_Lombok.jpg', 'Lombok_pink_beach.jpg', 'Sekaroh_pink_beach_NTB.jpg'],
        ],
    },
    {
        title: 'Selong Belanak Beach',
        description:
            'Pantai Selong Belanak adalah pantai berbentuk teluk yang indah dengan hamparan pasir putih ' +
            'halus sepanjang sekitar 2 kilometer di Kecamatan Praya Barat, Kabupaten Lombok Tengah, Nusa ' +
            'Tenggara Barat. Pantai ini dikenal memiliki ombak yang lebih ramah untuk pemula berselancar ' +
            'dibandingkan pantai-pantai lain di Lombok, sehingga menjadi lokasi belajar surfing yang ' +
            'sangat populer. Teluk alami yang terlindungi oleh perbukitan hijau di kedua sisinya ' +
            'menciptakan kondisi perairan yang tenang di bagian dalam teluk, sementara ombak yang ' +
            'konsisten tersedia di bagian luarnya. Desa-desa nelayan tradisional dengan perahu-perahu ' +
            'berwarna-warni (jukung) yang berjajar di tepi pantai menambah daya tarik pemandangan ' +
            'Selong Belanak yang masih sangat alami.',
        lat: -8.804800,
        lng: 116.079100,
        province: 'Nusa Tenggara Barat',
        city: 'Kabupaten Lombok Tengah',
        link: 'https://id.wikipedia.org/wiki/Selong_Belanak,_Praya_Barat,_Lombok_Tengah',
        imageCandidates: [
            ['Boats_in_selong_belanak.jpg', 'Selong_Belanak_Beach_Lombok.jpg', 'Selong_Belanak_bay_Lombok.jpg'],
            ['Selong_Belanak_Lombok_NTB.jpg', 'Pantai_Selong_Belanak.jpg', 'Selong_Belanak_beach_view.jpg'],
            ['Lombok_Selong_Belanak.jpg', 'Selong_Belanak_surfing.jpg', 'Praya_Barat_beach_Lombok.jpg'],
        ],
    },
    {
        title: 'Islamic Center NTB (Masjid Raya Hubbul Wathan)',
        description:
            'Masjid Raya Hubbul Wathan atau Islamic Center Nusa Tenggara Barat adalah masjid terbesar ' +
            'dan paling megah di Provinsi NTB, terletak di Kota Mataram, Pulau Lombok. Masjid yang ' +
            'pembangunannya dimulai tahun 2014 ini memiliki kapasitas menampung hingga 13.000 jamaah ' +
            'dan menara utamanya yang menjulang setinggi 99 meter melambangkan Asmaul Husna (99 nama ' +
            'Allah) dalam ajaran Islam. Arsitektur masjid ini memadukan gaya Timur Tengah dengan ' +
            'sentuhan Nusantara, dengan kubah utama berwarna keemasan yang berkilau dan menjadi ' +
            'landmark visual paling ikonik di Kota Mataram. Kompleks masjid ini juga berfungsi sebagai ' +
            'pusat pendidikan Islam, kegiatan sosial kemasyarakatan, dan telah menjadi ikon kebanggaan ' +
            'warga Nusa Tenggara Barat.',
        lat: -8.578600,
        lng: 116.109600,
        province: 'Nusa Tenggara Barat',
        city: 'Kota Mataram',
        link: 'https://id.wikipedia.org/wiki/Masjid_Hubbul_Wathan',
        imageCandidates: [
            ['Islamic_Center_NTB_Mataram.jpg', 'Masjid_Hubbul_Wathan_NTB.jpg', 'Islamic_Center_Lombok.jpg'],
            ['Masjid_Raya_Hubbul_Wathan.jpg', 'Islamic_Center_NTB.jpg', 'Hubbul_Wathan_mosque_Mataram.jpg'],
            ['Masjid_Islamic_Center_NTB.jpg', 'Mataram_mosque_NTB.jpg', 'Masjid_Hubbul_Wathan_Mataram.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (NTB)');
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
