/**
 * scripts/seed-banten-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for Banten Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-banten-pins.js
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
// Pin data — 10 iconic & historic places in Banten
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Masjid Agung Banten',
        description:
            'Masjid Agung Banten adalah masjid bersejarah yang didirikan pada abad ke-16 oleh Sultan ' +
            'Maulana Hasanuddin, pendiri Kesultanan Banten, dan merupakan salah satu masjid tertua di ' +
            'Indonesia. Arsitekturnya memadukan gaya Jawa, Tionghoa, dan Eropa, dengan menara setinggi ' +
            '24 meter yang dirancang oleh arsitek Belanda Hendrik Lucasz Cardeel dan menjadi ciri khas ' +
            'yang unik. Kompleks masjid ini juga mencakup makam para sultan Banten, termasuk Sultan Ageng ' +
            'Tirtayasa, sehingga menjadikannya pusat ziarah yang sangat penting bagi umat Islam. Masjid ' +
            'ini terletak di kawasan Banten Lama dan telah ditetapkan sebagai cagar budaya nasional ' +
            'Indonesia yang wajib dilestarikan.',
        lat: -6.035927,
        lng: 106.154102,
        province: 'Banten',
        city: 'Kota Serang',
        link: 'https://id.wikipedia.org/wiki/Masjid_Agung_Banten',
        imageCandidates: [
            ['Masjid_agung_banten_lama.jpg', 'Banten_Masjid_Agung_Banten.jpg', 'MENARA_MASJID_AGUNG_BANTEN.jpg'],
            ['Masjid_Banten_221230-190119_srg.jpg', 'Masjid_Banten_221230-190508_srg.jpg', 'Masjid_Banten_221230-190644_srg.jpg'],
            ['Masjid_Banten_111225_0526_mer.JPG', 'Masjid_Banten_111225_0560_mer.JPG', 'Masjid_Banten_221230-190252_srg.jpg'],
        ],
    },
    {
        title: 'Benteng Speelwijk',
        description:
            'Benteng Speelwijk adalah benteng peninggalan kolonial Belanda yang dibangun oleh VOC pada ' +
            'tahun 1682 di kawasan Banten Lama, dan dinamai sesuai nama Gubernur Jenderal Cornelis ' +
            'Speelman. Benteng ini dibangun untuk mengawasi dan mengendalikan Pelabuhan Banten yang ' +
            'merupakan salah satu pelabuhan perdagangan terpenting di Asia pada masa itu. Saat ini ' +
            'benteng tersebut telah menjadi reruntuhan yang sebagian besar terdiri dari dinding bata ' +
            'merah, parit, dan beberapa menara pengawas yang masih berdiri kokoh. Benteng Speelwijk ' +
            'ditetapkan sebagai situs cagar budaya dan merupakan saksi bisu persaingan dagang antara ' +
            'Kesultanan Banten dan VOC Belanda.',
        lat: -6.031082,
        lng: 106.150760,
        province: 'Banten',
        city: 'Kota Serang',
        link: 'https://id.wikipedia.org/wiki/Benteng_Speelwijk',
        imageCandidates: [
            ['Benteng_Speelwijk_(1).jpg', 'Benteng_Speelwijk_(2).jpg', 'Benteng_Speelwijk_(3).jpg'],
            ['Benteng_Speelwijk_(4).jpg', 'Benteng_Speelwijk_(5).jpg', 'Benteng_Speelwijk_(6).jpg'],
            ['Benteng_Speelwijk_(7).jpg', 'Benteng_Speelwijk_(9).jpg', 'Benteng_Speelwijk_(12).jpg'],
        ],
    },
    {
        title: 'Keraton Kaibon',
        description:
            'Keraton Kaibon adalah situs reruntuhan istana Kesultanan Banten yang dibangun pada abad ' +
            'ke-18 sebagai kediaman Ratu Aisyah, ibunda Sultan Syafiuddin. Keraton ini dihancurkan oleh ' +
            'pasukan Belanda di bawah pimpinan Herman Willem Daendels pada tahun 1832 sebagai bagian ' +
            'dari upaya penghancuran pusat kekuasaan Kesultanan Banten. Kini yang tersisa hanyalah ' +
            'reruntuhan gerbang, dinding bata, dan pondasi bangunan yang ditumbuhi vegetasi tropis, ' +
            'menciptakan pemandangan yang dramatis dan fotogenik. Situs ini telah ditetapkan sebagai ' +
            'cagar budaya nasional dan menjadi objek wisata sejarah yang populer di Kota Serang.',
        lat: -6.043835,
        lng: 106.160002,
        province: 'Banten',
        city: 'Kota Serang',
        link: 'https://id.wikipedia.org/wiki/Keraton_Kaibon',
        imageCandidates: [
            ['Keraton_Kaibon-1.jpg', 'Keraton_Kaibon-2.jpg', 'Keraton_Kaibon-3.jpg'],
            ['Keraton_Kaibon-5.jpg', 'Keraton_Kaibon-8.jpg', 'Keraton_Kaibon-10.jpg'],
            ['Eks_Keraton_Kaibon_-_panoramio.jpg', 'KERATON_KAIBON_BANTEN.jpg', 'Keraton_Kaibon_bagian_lantai.jpg'],
        ],
    },
    {
        title: 'Keraton Surosowan',
        description:
            'Keraton Surosowan adalah situs reruntuhan istana utama Kesultanan Banten yang didirikan ' +
            'oleh Sultan Maulana Hasanuddin pada abad ke-16 dan berfungsi sebagai pusat pemerintahan ' +
            'kerajaan selama lebih dari dua abad. Istana megah ini pernah memiliki tembok pertahanan ' +
            'setinggi sekitar 5 meter dengan ketebalan hingga 2 meter, beserta kolam pemandian dan taman ' +
            'yang luas. Keraton ini dihancurkan oleh Gubernur Jenderal Herman Willem Daendels pada tahun ' +
            '1809 setelah Kesultanan Banten menolak tunduk kepada pemerintah kolonial Belanda. Saat ini ' +
            'reruntuhan dindingnya masih berdiri kokoh dan menjadi satu dari situs warisan budaya paling ' +
            'signifikan di Provinsi Banten.',
        lat: -6.038130,
        lng: 106.155722,
        province: 'Banten',
        city: 'Kota Serang',
        link: 'https://id.wikipedia.org/wiki/Keraton_Surosowan',
        imageCandidates: [
            ['Keraton_Surosowan_(1).jpg', 'Keraton_Surosowan_(2).jpg', 'Keraton_Surosowan_(3).jpg'],
            ['Keraton_Surosowan_(4).jpg', 'Keraton_Surosowan_(5).jpg', 'Keraton_Surosowan_(6).jpg'],
            ['Keraton_Surosowan.jpg', 'Plang_nama_Keraton_Surosowan.jpg', 'Keraton_Surosowan_(7).jpg'],
        ],
    },
    {
        title: 'Gunung Anak Krakatau',
        description:
            'Gunung Anak Krakatau adalah gunung berapi aktif yang muncul dari kaldera Krakatau purba ' +
            'di tengah Selat Sunda, pertama kali terlihat muncul ke permukaan laut pada tahun 1927 dan ' +
            'terus tumbuh hingga kini. Gunung ini merupakan "anak" dari Gunung Krakatau yang meletus ' +
            'dahsyat pada tahun 1883 dan menewaskan lebih dari 36.000 jiwa serta mengubah iklim global ' +
            'sementara. Pada Desember 2018, longsoran badan gunung ini memicu tsunami yang menghantam ' +
            'pesisir Banten dan Lampung, menewaskan ratusan orang. Kawasan ini kini menjadi bagian dari ' +
            'Cagar Alam Krakatau yang dikelola sebagai kawasan wisata vulkanologi dan penelitian geologi ' +
            'bertaraf internasional.',
        lat: -6.102950,
        lng: 105.422176,
        province: 'Banten',
        city: 'Kabupaten Serang',
        link: 'https://id.wikipedia.org/wiki/Anak_Krakatau',
        imageCandidates: [
            ['Anak_Krakatau.jpg', 'Anak_Krakatau-1.JPG', 'Anak_Krakatau-2.JPG'],
            ['Anak_Krakatau_(29988082317).jpg', 'Anak_krakatau_sebelum_tsunami.jpg', 'Anak_Krakatau_Crater.JPG'],
            ['Gugusan_Pulau_Anak_Krakatau.1._10042017.jpg', 'Uprising-mt_anak_krakatau.jpg', 'Anak_Krakatau_erupts_in_Indonesia_(Copernicus_2023-12-16).jpg'],
        ],
    },
    {
        title: 'Pantai Anyer',
        description:
            'Pantai Anyer adalah kawasan pantai wisata yang membentang di pesisir barat Provinsi Banten, ' +
            'terletak sekitar 140 km dari Jakarta dan menjadi destinasi wisata bahari paling populer ' +
            'bagi warga Jabodetabek. Pantai ini terkenal dengan pasir putih yang bersih, ombak yang ' +
            'tenang, dan pemandangan Selat Sunda dengan latar belakang Gunung Krakatau di kejauhan. ' +
            'Kawasan Anyer juga memiliki nilai historis penting sebagai titik awal pembangunan Jalan ' +
            'Daendels yang dibangun oleh Gubernur Jenderal Belanda pada tahun 1808 sepanjang hampir ' +
            '1.000 km dari Anyer hingga Panarukan. Berbagai resor berbintang, villa, dan fasilitas ' +
            'wisata bahari tersedia di sepanjang garis pantai ini yang menghadap langsung ke Selat Sunda.',
        lat: -6.053145,
        lng: 105.914726,
        province: 'Banten',
        city: 'Kabupaten Serang',
        link: 'https://id.wikipedia.org/wiki/Anyer',
        imageCandidates: [
            ['Pantai_Anyer_Banten_Indonesia.jpg', 'Anyer_Indonesia_(56298228).jpeg', 'Sunset_and_Silhouette_in_Anyer_Beach,_Banten,_30102016.jpg'],
            ['Beach_in_Banten.jpg', 'Beach_in_Banten_2.jpg', 'Pantai_Anyer_Banten_Indonesia.jpg'],
            ['Anyer_Indonesia_(56298228).jpeg', 'Sunset_and_Silhouette_in_Anyer_Beach,_Banten,_30102016.jpg', 'Beach_in_Banten.jpg'],
        ],
    },
    {
        title: 'Mercusuar Cikoneng',
        description:
            'Mercusuar Cikoneng, juga dikenal sebagai Menara Suar Anyer atau "Titik Nol" Jalan Daendels, ' +
            'adalah mercusuar bersejarah yang dibangun oleh pemerintah Belanda pada tahun 1885 di ' +
            'Kecamatan Anyer, Kabupaten Serang. Menara ini memiliki tinggi sekitar 75 meter dari ' +
            'permukaan laut dan merupakan salah satu mercusuar tertinggi di Indonesia yang masih ' +
            'beroperasi hingga kini sebagai navigasi maritim di Selat Sunda. Mercusuar ini dibangun ' +
            'untuk menggantikan mercusuar sebelumnya yang hancur akibat letusan Gunung Krakatau pada ' +
            'tahun 1883, dan menjadi penanda penting bagi pelayaran di Selat Sunda. Selain fungsi ' +
            'navigasinya, mercusuar ini juga ditetapkan sebagai cagar budaya karena nilai sejarahnya ' +
            'sebagai titik awal pembangunan Jalan Raya Pos Daendels.',
        lat: -6.070679,
        lng: 105.885256,
        province: 'Banten',
        city: 'Kabupaten Serang',
        link: 'https://id.wikipedia.org/wiki/Mercusuar_Cikoneng',
        imageCandidates: [
            ['COLLECTIE_TROPENMUSEUM_Anjer_vuurtoren_TMnr_10010402.jpg', 'COLLECTIE_TROPENMUSEUM_Vuurtoren_bij_Anjer-Kidoel_ofwel_Java\'s_vierde_punt_TMnr_10010406.jpg', 'COLLECTIE_TROPENMUSEUM_De_vuurtoren_op_Java\'s_Vierde_Punt_Anjer-kidoel_TMnr_60012796.jpg'],
            ['COLLECTIE_TROPENMUSEUM_Gezicht_vanaf_de_vuurtoren_van_Anjer_over_het_bij_laag_water_drooggevallen_koraalrif_en_het_begin_van_de_Grote_Postweg_TMnr_10018452.jpg', 'COLLECTIE_TROPENMUSEUM_Anjer_vuurtoren_TMnr_10010402.jpg', 'Cikoneng_lighthouse_Anyer_Banten.jpg'],
            ['Menara_suar_Anyer_Cikoneng.jpg', 'Anyer_lighthouse_Banten.jpg', 'Mercusuar_Cikoneng_Anyer.jpg'],
        ],
    },
    {
        title: 'Taman Nasional Ujung Kulon',
        description:
            'Taman Nasional Ujung Kulon adalah kawasan konservasi alam yang terletak di ujung barat ' +
            'daya Pulau Jawa dan telah ditetapkan sebagai Situs Warisan Dunia UNESCO sejak tahun 1991. ' +
            'Taman nasional ini merupakan habitat alami terakhir dan terpenting bagi badak Jawa ' +
            '(Rhinoceros sondaicus), salah satu mamalia paling terancam punah di dunia dengan populasi ' +
            'kurang dari 80 ekor. Kawasan ini mencakup area seluas sekitar 122.956 hektar, meliputi ' +
            'hutan hujan tropis dataran rendah, padang rumput, hutan mangrove, terumbu karang, serta ' +
            'Pulau Panaitan dan gugusan Kepulauan Krakatau. Selain badak Jawa, taman ini juga menjadi ' +
            'rumah bagi banteng, rusa, lutung Jawa, kucing hutan, dan berbagai spesies burung langka ' +
            'yang dilindungi.',
        lat: -6.751449,
        lng: 105.317796,
        province: 'Banten',
        city: 'Kabupaten Pandeglang',
        link: 'https://id.wikipedia.org/wiki/Taman_Nasional_Ujung_Kulon',
        imageCandidates: [
            ['Ujung_Kulon_National_Park,_2014.jpg', 'Ujung_kulon_-_indonesie.jpg', 'Snorkeling_at_Ujung_Kulon_National_Park.jpg'],
            ['232_UJUNG_KULON.JPG', 'Sunset_In_Tanjung_Lame,_Ujung_Kulon.jpg', 'Babi_hutan_lagi_cari_makan_siang_di_pulau_peucang_yang_berada_di_Taman_nasional_ujung_kulon,_Jawa_Barat.jpg'],
            ['Kelomang,_Cibunar,_Taman_Nasional_Ujung_Kulon,_11082014.jpg', 'Monyet_ekor_panjang_(Macaca_fascicularis),_Cidaon,_Taman_Nasional_Ujung_Kulon,_18082014.jpg', 'Ujung_Kulon_National_Park,_2014.jpg'],
        ],
    },
    {
        title: 'Pantai Sawarna',
        description:
            'Pantai Sawarna adalah kawasan wisata pantai yang terletak di Desa Sawarna, Kecamatan Bayah, ' +
            'Kabupaten Lebak, Banten, dan dikenal sebagai salah satu pantai tersembunyi paling indah ' +
            'di Pulau Jawa. Pantai ini menawarkan pemandangan tebing karang dramatis, ombak besar yang ' +
            'ideal untuk selancar, laguna alami, dan pasir putih yang masih sangat alami. Ikon paling ' +
            'terkenal di kawasan ini adalah Tanjung Layar, sebuah tebing karang kembar berbentuk layar ' +
            'kapal yang menjulang dari laut dan telah menjadi simbol keindahan alam Pantai Sawarna. ' +
            'Kawasan ini menjadi surga bagi para peselancar dan pencinta wisata alam yang menginginkan ' +
            'pengalaman pantai yang autentik dan jauh dari keramaian.',
        lat: -6.978167,
        lng: 106.298732,
        province: 'Banten',
        city: 'Kabupaten Lebak',
        link: 'https://id.wikipedia.org/wiki/Sawarna,_Bayah,_Lebak',
        imageCandidates: [
            ['Pantai_Sawarna,_Banten.jpg', 'Pantai_Sawarna.jpg', 'Surfing_Sawarna,_2017.jpg'],
            ['Tanjung_Layar,_Sawarna.jpg', 'Sunset_Pantai_Tanjung_Layar.jpg', 'Icon_if_Tanjung_Layar,_Sawarna.jpg'],
            ['Ciantir_Beach_at_dawn_2023_00.jpg', 'Tanjung_Layar_beach,_16-08-2014.jpg', 'Pantai_Sawarna.jpg'],
        ],
    },
    {
        title: 'Danau Tasikardi',
        description:
            'Danau Tasikardi adalah danau buatan bersejarah yang dibangun pada abad ke-16 atas perintah ' +
            'Sultan Maulana Yusuf dari Kesultanan Banten sebagai waduk pengairan untuk lahan pertanian ' +
            'dan kebutuhan air istana. Danau seluas sekitar 5 hektar ini juga berfungsi sebagai tempat ' +
            'rekreasi keluarga kerajaan, dengan sebuah pulau kecil di tengahnya yang dahulu terdapat ' +
            'bangunan peristirahatan bagi para selir sultan. Sistem irigasi dari danau ini yang ' +
            'menghubungkan Tasikardi dengan Keraton Surosowan melalui saluran-saluran air mencerminkan ' +
            'tingginya kemampuan rekayasa hidrolika masyarakat Banten pada masa keemasan kesultanan. ' +
            'Situs ini kini dikelola sebagai kawasan wisata budaya dan edukasi sejarah, terletak hanya ' +
            'beberapa kilometer dari kompleks Banten Lama.',
        lat: -6.053683,
        lng: 106.143451,
        province: 'Banten',
        city: 'Kabupaten Serang',
        link: 'https://id.wikipedia.org/wiki/Tasikardi',
        imageCandidates: [
            ['Danau_Tasikardi-1.jpg', 'Danau_Tasikardi-2.jpg', 'Danau_Tasikardi-3.jpg'],
            ['Danau_Tasikardi-4.jpg', 'Danau_Tasikardi-5.jpg', 'Danau_Tasikardi-6.jpg'],
            ['Danau_Tasikardi.jpg', 'COLLECTIE_TROPENMUSEUM_Het_huis_voor_afgedankte_sultansvrouwen_op_een_eiland_in_het_kunstmatig_aangelegde_waterreservoir_Tasik_Ardi_te_Bantam_TMnr_10005138.jpg', 'COLLECTIE_TROPENMUSEUM_Europese_vrouw_op_fiets_met_kind_voor_het_filterhuis_voor_de_waterleiding_die_loopt_van_het_kunstmatig_aangelegde_meertje_Tasik_Ardi_naar_de_kraton_TMnr_10005139.jpg'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (Banten)');
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
