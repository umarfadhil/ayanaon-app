/**
 * scripts/seed-diy-pins.js
 *
 * Seeds 10 iconic & historic pins in "Tempat Ikonik & Bersejarah" category
 * for DI Yogyakarta Province, with 2-3 representative photos each.
 *
 * Usage:
 *   MONGODB_URI=<your-uri> node scripts/seed-diy-pins.js
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
// Pin data — 10 iconic & historic places in DI Yogyakarta
// ---------------------------------------------------------------------------

const PINS = [
    {
        title: 'Kraton Ngayogyakarta Hadiningrat',
        description:
            'Kraton Ngayogyakarta Hadiningrat adalah istana resmi Kesultanan Yogyakarta yang didirikan ' +
            'oleh Sultan Hamengkubuwono I pada tahun 1755–1756, setelah penandatanganan Perjanjian ' +
            'Giyanti yang membagi Kerajaan Mataram menjadi dua. Terletak di jantung Kota Yogyakarta, ' +
            'keraton megah ini merupakan pusat kebudayaan, adat istiadat, dan pemerintahan Kesultanan ' +
            'Yogyakarta yang masih aktif berfungsi hingga saat ini. Kompleks seluas 14.000 m² ini ' +
            'mencakup pendopo agung, bangsal kencana, museum keraton, dan berbagai bangunan bersejarah ' +
            'yang dihiasi ukiran dan ornamen Jawa yang indah. Keraton ini juga menjadi pusat ' +
            'pelestarian seni tari, wayang, gamelan, dan berbagai tradisi budaya Jawa.',
        lat: -7.807597,
        lng: 110.363870,
        province: 'DI Yogyakarta',
        city: 'Kota Yogyakarta',
        link: 'https://id.wikipedia.org/wiki/Keraton_Yogyakarta',
        imageCandidates: [
            ['Yogyakarta Indonesia Kraton-the-Sultans-Palace-02.jpg', 'Kraton Ngayogyakarta Hadiningrat (49797461187).jpg'],
            ['Kraton Ngayogyakarta Hadiningrat, Yogyakarta, Indonesia, 20220818 1003 8888.jpg', 'Kraton Ngayogyakarta Hadiningrat (49796608068).jpg'],
            ['Kraton Ngayogyakarta Hadiningrat (49797153901).jpg', 'Kraton Ngayogyakarta Hadiningrat (49797461187).jpg'],
        ],
    },
    {
        title: 'Candi Prambanan',
        description:
            'Candi Prambanan adalah kompleks candi Hindu terbesar di Indonesia dan salah satu yang ' +
            'terbesar di Asia Tenggara, dibangun pada abad ke-9 Masehi pada masa pemerintahan Raja ' +
            'Rakai Pikatan dari Dinasti Sanjaya. Terletak di perbatasan Provinsi Jawa Tengah dan ' +
            'DI Yogyakarta, kompleks ini didominasi oleh tiga candi utama yang dipersembahkan untuk ' +
            'Trimurti Hindu — Brahma, Wisnu, dan Siwa — dengan Candi Siwa sebagai yang tertinggi ' +
            'setinggi 47 meter. UNESCO menetapkan Prambanan sebagai Warisan Budaya Dunia pada tahun ' +
            '1991. Kompleks ini juga terkenal sebagai tempat pertunjukan sendratari Ramayana yang ' +
            'spektakuler di panggung terbuka dengan latar candi yang megah.',
        lat: -7.752227,
        lng: 110.491533,
        province: 'DI Yogyakarta',
        city: 'Kabupaten Sleman',
        link: 'https://id.wikipedia.org/wiki/Candi_Prambanan',
        imageCandidates: [
            ['Prambanan temple, Central Java, Indonesia, 20220818 1311 9139.jpg', 'Yogyakarta Indonesia Prambanan-temple-complex-21.jpg'],
            ['Widok na Świątynię Prambanan na Jawie, 20220818 1318 9165.jpg', 'Widok na Świątynię Prambanan na Jawie, 20220818 1315 9157.jpg'],
            ['Yogyakarta Indonesia Prambanan-temple-complex-23.jpg', 'Prambanan temple, Central Java, Indonesia, 20220818 1311 9139.jpg'],
        ],
    },
    {
        title: 'Taman Sari Yogyakarta',
        description:
            'Taman Sari adalah bekas taman istana Kesultanan Yogyakarta yang dibangun antara tahun ' +
            '1758 dan 1765 atas perintah Sultan Hamengkubuwono I. Kompleks seluas sekitar 10 hektare ' +
            'ini dulunya berfungsi sebagai tempat peristirahatan, meditasi, dan pertahanan kerajaan, ' +
            'dengan kolam pemandian yang indah, lorong bawah air, masjid bawah tanah, dan berbagai ' +
            'bangunan bergaya perpaduan Jawa-Eropa. Kolam Umbul Binangun yang dikelilingi tembok tinggi ' +
            'adalah fitur paling ikonik yang dahulu menjadi tempat pemandian para putri keraton. ' +
            'Taman Sari kini menjadi salah satu destinasi wisata budaya terpopuler di Yogyakarta ' +
            'dan dikelilingi oleh kampung batik Kauman dan Kadipaten.',
        lat: -7.810032,
        lng: 110.359153,
        province: 'DI Yogyakarta',
        city: 'Kota Yogyakarta',
        link: 'https://id.wikipedia.org/wiki/Taman_Sari_Yogyakarta',
        imageCandidates: [
            ['Taman Sari Water Castle, Yogyakarta, 20220818 1041 8964.jpg', 'Taman Sari Water Castle, Yogyakarta, 20220818 1037 8930.jpg'],
            ['Taman Sari Water Castle, Yogyakarta, 20220818 1039 8950.jpg', 'Taman Sari Water Castle, Yogyakarta, 20220818 1047 8996.jpg'],
            ['Taman Sari Water Castle, Yogyakarta, 20220818 1045 8988.jpg', 'Taman Sari Water Castle, Yogyakarta, 20220818 1041 8964.jpg'],
        ],
    },
    {
        title: 'Pantai Parangtritis',
        description:
            'Pantai Parangtritis adalah pantai paling terkenal di Provinsi DI Yogyakarta, terletak ' +
            'di Kecamatan Kretek, Kabupaten Bantul, sekitar 27 kilometer selatan Kota Yogyakarta, ' +
            'menghadap Samudra Hindia. Pantai ini memiliki nilai spiritual yang sangat tinggi bagi ' +
            'masyarakat Jawa karena dipercaya sebagai lokasi pertemuan antara Sultan Yogyakarta dan ' +
            'Nyi Roro Kidul, Ratu Laut Selatan dalam mitologi Jawa. Hamparan pasir hitam yang luas, ' +
            'ombak besar dari Samudra Hindia, dan bukit-bukit pasir (gumuk pasir) yang unik menjadi ' +
            'ciri khas pantai ini. Parangtritis merupakan destinasi wisata alam dan budaya terpenting ' +
            'di Yogyakarta yang ramai dikunjungi sepanjang tahun.',
        lat: -8.027283,
        lng: 110.337008,
        province: 'DI Yogyakarta',
        city: 'Kabupaten Bantul',
        link: 'https://id.wikipedia.org/wiki/Parangtritis',
        imageCandidates: [
            ['Panorama of Parangtritis Beach on a cloudy afternoon (1).jpg', 'Pantai parangtritis (3).jpg'],
            ['Playing on the edge of Parangtritis Beach (1).jpg', 'View of the coast of Parangtritis Beach seen from Paralayang Peak.jpg'],
            ['Sepi Pengunjung - Pantai Parangtritis, Bantul, DIY.jpg', 'Panorama of Parangtritis Beach on a cloudy afternoon (1).jpg'],
        ],
    },
    {
        title: 'Gunung Merapi',
        description:
            'Gunung Merapi adalah gunung berapi paling aktif di Indonesia dan salah satu yang paling ' +
            'berbahaya di dunia, terletak di perbatasan Provinsi Jawa Tengah dan DI Yogyakarta dengan ' +
            'ketinggian 2.930 meter di atas permukaan laut. Gunung berapi bertipe stratavolkano ini ' +
            'telah meletus lebih dari 68 kali sejak 1548, dengan letusan besar terakhir terjadi pada ' +
            'Oktober–November 2010 yang menelan korban jiwa dan memaksa ratusan ribu warga mengungsi. ' +
            'Kawasan Taman Nasional Gunung Merapi yang mengelilinginya menawarkan wisata pendakian, ' +
            'lava tour dengan jeep, dan museum vulkanologi. Merapi juga memiliki nilai spiritual ' +
            'mendalam bagi masyarakat Jawa sebagai "penjaga" Kerajaan Mataram.',
        lat: -7.541289,
        lng: 110.446201,
        province: 'DI Yogyakarta',
        city: 'Kabupaten Sleman',
        link: 'https://id.wikipedia.org/wiki/Gunung_Merapi',
        imageCandidates: [
            ['Gunung Merapi - Sawah - Perumahan.jpg', 'Merapi and Cloud.jpg'],
            ['Mount Merapi from the south side with rocks from the eruption.jpg', 'TN Gunung Merapi.jpg'],
            ['Merapi dari Bukit Klangon tahun 2024.jpg', 'Gunung Merapi - Sawah - Perumahan.jpg'],
        ],
    },
    {
        title: 'Benteng Vredeburg Yogyakarta',
        description:
            'Benteng Vredeburg adalah benteng peninggalan kolonial Belanda yang dibangun antara tahun ' +
            '1760 dan 1765 atas permintaan Sultan Hamengkubuwono I, awalnya dengan nama Rustenburg ' +
            '("benteng peristirahatan"). Terletak tepat di depan Kraton Yogyakarta di ujung selatan ' +
            'Jalan Malioboro, benteng ini dibangun oleh VOC dengan alasan keamanan namun sesungguhnya ' +
            'berfungsi untuk mengawasi aktivitas keraton. Setelah kemerdekaan Indonesia, benteng ini ' +
            'diubah menjadi Museum Benteng Vredeburg yang menyajikan diorama perjalanan perjuangan ' +
            'kemerdekaan Indonesia, khususnya yang berkaitan dengan Yogyakarta sebagai ibu kota ' +
            'Republik Indonesia pada masa revolusi 1945–1949.',
        lat: -7.800154,
        lng: 110.366336,
        province: 'DI Yogyakarta',
        city: 'Kota Yogyakarta',
        link: 'https://id.wikipedia.org/wiki/Benteng_Vredeburg',
        imageCandidates: [
            ['Fort Vredeburg, Yogyakarta, Indonesia.JPG', 'Museum Benteng Vredeburg Yogyakarta.jpg'],
            ['Museum Benteng Vredeburg Yogyakarta 1.jpg', 'Museum Benteng Vredeburg Yogyakarta 3.jpg'],
            ['Museum Benteng Vredeburg 02.jpg', 'Fort Vredeburg, Yogyakarta, Indonesia.JPG'],
        ],
    },
    {
        title: 'Museum Sonobudoyo Yogyakarta',
        description:
            'Museum Sonobudoyo adalah museum negeri terkemuka di Yogyakarta yang menyimpan koleksi ' +
            'benda-benda kebudayaan Jawa, Bali, dan Lombok yang sangat kaya, didirikan pada tahun ' +
            '1935 oleh Java Instituut. Terletak di sisi utara Alun-Alun Utara Keraton Yogyakarta, ' +
            'museum ini memiliki bangunan bergaya arsitektur Jawa tradisional dengan koleksi mencakup ' +
            'wayang kulit, batik, keris, arca Hindu-Buddha, gamelan, topeng, peralatan upacara, ' +
            'dan naskah-naskah kuno. Koleksi kerisnya merupakan salah satu yang terlengkap di dunia. ' +
            'Museum Sonobudoyo juga dikenal sebagai salah satu tempat terbaik untuk menyaksikan ' +
            'pertunjukan wayang kulit setiap malam.',
        lat: -7.802137,
        lng: 110.363781,
        province: 'DI Yogyakarta',
        city: 'Kota Yogyakarta',
        link: 'https://id.wikipedia.org/wiki/Museum_Sonobudoyo',
        imageCandidates: [
            ['Museum Sonobudoyo Yogyakarta Unit 1.jpg', 'Museum Sonobudoyo.jpg'],
            ['Pondok Wayang Museum Sonobudoyo Yogyakarta Unit 1.jpg', 'Storage room for ancient manuscripts at the Sonobudoyo Museum Unit II.jpg'],
            ['Javanese tembang and dance fusion performance, Sonobudoyo Museum, Yogyakarta, 2017-12-05 11.jpg', 'Museum Sonobudoyo Yogyakarta Unit 1.jpg'],
        ],
    },
    {
        title: 'Candi Kalasan',
        description:
            'Candi Kalasan adalah candi Buddha tertua di Yogyakarta, dibangun pada tahun 778 Masehi ' +
            'berdasarkan prasasti Kalasan yang mengindikasikan pembangunannya atas perintah Dinasti ' +
            'Syailendra untuk menghormati Dewi Tara dan para Guru Agama. Terletak di Desa Kalasan, ' +
            'Kecamatan Kalasan, Kabupaten Sleman, sekitar 14 kilometer timur Kota Yogyakarta, candi ' +
            'ini memiliki arsitektur campuran gaya India Selatan (Pallawa) dan Jawa dengan ukiran ' +
            'yang sangat halus. Relief kala-makara yang mengelilingi pintu-pintunya terkenal sebagai ' +
            'salah satu yang terindah dalam seni pahat Jawa kuno. Permukaan luarnya dahulu dilapisi ' +
            'vajralepa, sejenis semen kuno yang mengkilap.',
        lat: -7.766806,
        lng: 110.472400,
        province: 'DI Yogyakarta',
        city: 'Kabupaten Sleman',
        link: 'https://id.wikipedia.org/wiki/Candi_Kalasan',
        imageCandidates: [
            ['Kalasan Temple from the north-east, 23 November 2013.jpg', 'Kalasan Temple.jpg'],
            ['Candi Kalasan, Java 1122.jpg', 'North face of Candi Kalasan, Java 1110.jpg'],
            ['Kalasan Temple from the south-south-east, 23 November 2013.jpg', 'Candi Kalasan, Java 1122.jpg'],
        ],
    },
    {
        title: 'Monumen Jogja Kembali (Monjali)',
        description:
            'Monumen Jogja Kembali atau disingkat Monjali adalah monumen bersejarah yang dibangun ' +
            'untuk memperingati kembalinya ibu kota Republik Indonesia ke Yogyakarta pada 29 Juni ' +
            '1949, setelah sebelumnya diduduki oleh Belanda dalam Agresi Militer II. Terletak di ' +
            'Jalan Ring Road Utara, Sleman, monumen berbentuk kerucut (gunungan) setinggi 31,8 meter ' +
            'ini resmi dibuka pada 29 Juni 1985. Di dalamnya terdapat tiga lantai museum yang menyimpan ' +
            'koleksi senjata, foto, diorama, dan dokumentasi perjuangan kemerdekaan Indonesia, ' +
            'khususnya peristiwa Serangan Umum 1 Maret 1949 yang dipimpin oleh Letkol Soeharto. ' +
            'Monumen ini menjadi simbol semangat perjuangan dan patriotisme rakyat Yogyakarta.',
        lat: -7.749624,
        lng: 110.369634,
        province: 'DI Yogyakarta',
        city: 'Kabupaten Sleman',
        link: 'https://id.wikipedia.org/wiki/Monumen_Jogja_Kembali',
        imageCandidates: [
            ['Monumen Yogya Kembali.JPG', 'Guerrilla outfit on mannequin, Monjali.jpg'],
            ['Laswi uniform on mannequin, Monjali.jpg', 'PETA uniform on mannequin, Monjali.jpg'],
            ['Guerrilla outfit on mannequin, Monjali.jpg', 'Monumen Yogya Kembali.JPG'],
        ],
    },
    {
        title: 'Jalan Malioboro Yogyakarta',
        description:
            'Jalan Malioboro adalah jalan legendaris dan ikon utama Kota Yogyakarta yang membentang ' +
            'sekitar 2 kilometer dari Tugu Yogyakarta di utara hingga perempatan Kantor Pos di selatan, ' +
            'menjadi sumbu filosofis "Garis Imajiner Yogyakarta" yang menghubungkan Gunung Merapi, ' +
            'Tugu Yogyakarta, Keraton, Panggung Krapyak, hingga Pantai Parangkusumo. Jalan ini ' +
            'terkenal sebagai surga belanja produk kerajinan tangan, batik, perak, dan berbagai ' +
            'suvenir khas Yogyakarta, dengan deretan pedagang kaki lima di sepanjang trotoar dan ' +
            'puluhan toko di balik arkade. Malioboro juga menjadi pusat kehidupan seni dan budaya ' +
            'Yogyakarta, dengan pertunjukan musik jalanan, pelukis, dan berbagai seniman yang ' +
            'menampilkan kreasi mereka setiap hari.',
        lat: -7.794502,
        lng: 110.365618,
        province: 'DI Yogyakarta',
        city: 'Kota Yogyakarta',
        link: 'https://id.wikipedia.org/wiki/Jalan_Malioboro',
        imageCandidates: [
            ['Malioboro Street, Yogyakarta.JPG', 'Daytime atmosphere on Malioboro Street, Yogyakarta.jpg'],
            ['Traffic along Malioboro Street (2).jpg', 'Ketandan, the Chinatown area on Malioboro Street, Yogyakarta (1).jpg'],
            ['Ketandan, the Chinatown area on Malioboro Street, Yogyakarta (2).jpg', 'Malioboro Street, Yogyakarta.JPG'],
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
    console.log(' AyaNaon — Seed: Tempat Ikonik & Bersejarah (DI Yogyakarta)');
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
