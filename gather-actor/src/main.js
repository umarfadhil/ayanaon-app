import { Actor } from 'apify';
import { PlaywrightCrawler, RequestQueue } from 'crawlee';
import { buildPertaminaDescription } from './pertamina-utils.js';
import { buildSpkluDescription } from './spklu-utils.js';
import { buildTiketDescription, cleanTiketLocation, normalizeTiketPrice } from './tiket-utils.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TODAY = new Date().toISOString().slice(0, 10);
const YESPLIS_API_BASE = 'https://api-v5.yesplis.com';
const MONTHS_ID = { januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, ags: 8, september: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12 };
const MONTHS_EN = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
    sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12
};
const CATEGORIES = {
    event: '🎉 Konser Musik & Acara', social: '🧑‍🤝‍🧑 Sosial & Kopdar',
    sport: '🏃 Olahraga & Aktivitas Hobi', hotel: '🏡 Akomodasi Pilihan',
    spbu: '⛽ SPBU/SPBG', spklu: '⚡ SPKLU', education: '🎓 Edukasi',
    culture: '🎭 Budaya & Hiburan', market: '🛒 Pasar Lokal & Pameran', other: '💡 Lain-lain'
};

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function identifier(value) {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'bigint') return String(value);
    return '';
}
function numeric(value) { if (value === null || value === '' || typeof value === 'undefined') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function decodeHtmlEntities(value) {
    const entities = {
        amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
        mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…'
    };
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|mdash|ndash|lsquo|rsquo|ldquo|rdquo|hellip);?/gi, (match, entity) => {
        if (entity[0] === '#') {
            const radix = entity[1].toLowerCase() === 'x' ? 16 : 10;
            const number = Number.parseInt(entity.slice(radix === 16 ? 2 : 1), radix);
            return Number.isFinite(number) ? String.fromCodePoint(number) : match;
        }
        return entities[entity.toLowerCase()] || match;
    });
}
function htmlToText(value) {
    let cleaned = text(value);
    if (!cleaned) return '';
    for (let pass = 0; pass < 3; pass += 1) {
        const decoded = decodeHtmlEntities(cleaned);
        if (decoded === cleaned) break;
        cleaned = decoded;
    }
    cleaned = cleaned
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/p\s*>/gi, '\n\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li\s*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '');
    return cleaned.split('\n')
        .map((line) => line.replace(/[\t ]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .replace(/^"(?=[^"]*$)/, '');
}
function canonicalLink(value) { return text(value).replace(/#.*$/, '').replace(/\/$/, ''); }
function createExclusions(input) {
    return {
        externalIds: new Set((Array.isArray(input.excludeExternalIds) ? input.excludeExternalIds : []).map(text).filter(Boolean)),
        links: new Set((Array.isArray(input.excludeLinks) ? input.excludeLinks : []).map(canonicalLink).filter(Boolean))
    };
}
function isExcluded(exclusions, item = {}) {
    const externalId = identifier(item.externalId || item.id);
    const link = canonicalLink(item.link);
    return Boolean((externalId && exclusions.externalIds.has(externalId)) || (link && exclusions.links.has(link)));
}
function isoDate(value) {
    const direct = /^(\d{4}-\d{2}-\d{2})/.exec(text(value));
    if (direct) return direct[1];
    const match = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(text(value));
    if (!match) return '';
    const month = MONTHS_ID[match[2].toLowerCase()] || MONTHS_EN[match[2].toLowerCase()];
    if (!month) return '';
    return `${match[3]}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
}
function dateRange(value) {
    const raw = text(value);
    const isoDates = [...raw.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((match) => match[0]);
    if (isoDates.length) return { startDate: isoDates[0], endDate: isoDates.at(-1) || isoDates[0] };
    const range = /(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*(?:-|\u2013|\u2014|to|sampai)\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i.exec(raw);
    if (range) {
        const startDate = isoDate(`${range[1]} ${range[2]} ${range[3] || range[6]}`);
        const endDate = isoDate(`${range[4]} ${range[5]} ${range[6]}`);
        return { startDate, endDate: endDate || startDate };
    }
    const single = isoDate(raw);
    return { startDate: single, endDate: single };
}
function normalizeImageUrls(values) {
    const urls = [];
    const visit = (value) => {
        if (!value || urls.length >= 3) return;
        if (Array.isArray(value)) return value.forEach(visit);
        if (typeof value === 'string') {
            const candidate = value.trim();
            if (/^https?:\/\//i.test(candidate) && !urls.includes(candidate)) urls.push(candidate);
            return;
        }
        if (typeof value !== 'object') return;
        ['url', 'src', 'imageUrl', 'image_url', 'photoUrl', 'photo_url', 'original', 'large', 'medium'].forEach((key) => visit(value[key]));
    };
    visit(values);
    return urls.slice(0, 3);
}
function normalize(item, source) {
    return {
        source,
        externalId: identifier(item.externalId || item.id),
        title: htmlToText(item.title),
        description: htmlToText(item.description),
        category: text(item.category),
        link: text(item.link),
        startDate: isoDate(item.startDate),
        endDate: isoDate(item.endDate || item.startDate),
        lat: numeric(item.lat),
        lng: numeric(item.lng),
        images: normalizeImageUrls([item.images, item.imageUrls, item.image, item.banner, item.cover, item.poster, item.thumbnail]),
        sourceMeta: item.sourceMeta || {}
    };
}
function isUpcoming(item) { return !item.endDate || item.endDate >= TODAY; }
function money(value) { const amount = numeric(value); return amount === null ? 'Harga belum tersedia' : amount === 0 ? 'Gratis' : `Mulai dari Rp${Math.round(amount).toLocaleString('id-ID')}`; }
function classify(...values) {
    const blob = values.filter(Boolean).join(' ').toLowerCase();
    if (/(seminar|workshop|education|training|class)/.test(blob)) return CATEGORIES.education;
    if (/(sport|run|marathon|race|tournament|cycling|esport)/.test(blob)) return CATEGORIES.sport;
    if (/(culture|art|film|theat|dance)/.test(blob)) return CATEGORIES.culture;
    if (/(bazaar|market|expo|exhibition|fair)/.test(blob)) return CATEGORIES.market;
    if (/(community|social|charity|volunteer|kopdar)/.test(blob)) return CATEGORIES.social;
    if (/(concert|music|festival|gig|orchestra)/.test(blob)) return CATEGORIES.event;
    return CATEGORIES.other;
}
async function fetchJson(url, options = {}, retries = 3) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt += 1) {
        try {
            const response = await fetch(url, { ...options, headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', ...(options.headers || {}) } });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
    }
    throw lastError;
}

function actorFailureMessage(source, error) {
    const sourceName = source === 'yesplis' ? 'Yesplis' : `Scraper ${source || 'eksternal'}`;
    const causes = [];
    for (let current = error; current && !causes.includes(current); current = current.cause) causes.push(current);
    const dnsError = causes.find((item) => item?.code === 'ENOTFOUND');
    if (dnsError) {
        const host = text(dnsError.hostname) || 'sumber eksternal';
        return `${sourceName} gagal: host ${host} tidak ditemukan (DNS).`;
    }
    const detail = causes.map((item) => text(item?.message)).find((message) => message && message !== 'fetch failed')
        || text(error?.message)
        || 'Kesalahan sumber tidak diketahui.';
    return `${sourceName} gagal: ${detail}`.slice(0, 240);
}
async function geocode(query) {
    const exact = text(query);
    if (!exact) return { lat: null, lng: null };
    const parts = exact.split(',').map((part) => part.trim()).filter(Boolean);
    const venueLocality = parts.length >= 3 ? `${parts[0]}, ${parts.at(-2)}, ${parts.at(-1)}` : '';
    const candidates = [...new Set([exact, venueLocality, parts.length > 1 ? parts.slice(1).join(', ') : ''].filter(Boolean))];
    for (const candidate of candidates) {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=id&q=${encodeURIComponent(candidate)}`;
        try {
            const rows = await fetchJson(url, { headers: { 'user-agent': 'AyaNaonGather/1.0 contact@ayanaon.app' } });
            const lat = numeric(rows?.[0]?.lat);
            const lng = numeric(rows?.[0]?.lon);
            if (lat !== null && lng !== null) return { lat, lng };
        } catch {}
    }
    return { lat: null, lng: null };
}

async function scrapeLoket(limit, exclusions) {
    const filters = [['3', CATEGORIES.event], ['6', CATEGORIES.education], ['9', CATEGORIES.culture], ['2', CATEGORIES.market], ['32', CATEGORIES.social]];
    const output = [];
    const seen = new Set();
    for (const [filter, category] of filters) {
        for (let page = 1, pages = 1; page <= pages && output.length < limit; page += 1) {
            const payload = await fetchJson(`https://www.loket.com/api/v1/discover/events?f=${filter}&per_page=20&page=${page}`);
            const result = payload?.result || {};
            pages = Number(result.total_page || 1);
            for (const row of result.events || []) {
                const event = row.event || {};
                const link = text(event.url);
                if (!link || seen.has(link)) continue;
                seen.add(link);
                const schedule = row.schedule || {};
                const location = row.location || {};
                const slug = new URL(link).pathname.split('/').filter(Boolean).pop();
                if (isExcluded(exclusions, { externalId: slug, link })) continue;
                let detail = {};
                try { detail = (await fetchJson(`https://rest.loket.com/fusio/api/v1/public/events/${slug}`))?.result || {}; } catch {}
                const coords = detail?.location?.coordinate || detail?.coordinate || {};
                const address = [location.location_name, location.district, location.province].filter(Boolean).join(', ');
                const geo = numeric(coords.latitude ?? coords.lat) !== null
                    ? { lat: numeric(coords.latitude ?? coords.lat), lng: numeric(coords.longitude ?? coords.lng) }
                    : await geocode(address);
                output.push(normalize({
                    externalId: slug, title: event.name, category, link,
                    description: htmlToText(detail.description || detail.event_description) || `📍 ${address}`,
                    startDate: isoDate(schedule.start), endDate: isoDate(schedule.end || schedule.start),
                    images: [event.banner, event.image, row.banner, detail.event_banner, detail.event_banner_mobile,
                        detail.banner, detail.image, detail.cover, detail.media],
                    ...geo
                }, 'loket'));
                if (output.length >= limit) break;
            }
        }
    }
    return output.filter(isUpcoming);
}

async function scrapeYesplis(limit, exclusions) {
    const output = [];
    for (let page = 1; output.length < limit; page += 1) {
        const headers = { 'yp-page-code': 'https://www.yesplis.com/', Origin: 'https://www.yesplis.com', Referer: 'https://www.yesplis.com/' };
        const payload = await fetchJson(`${YESPLIS_API_BASE}/api/v3/public/events/landing-page?show=24&page=${page}`, { headers });
        const data = payload?.data || {};
        const rows = data.rows || [];
        if (!rows.length) break;
        for (const summary of rows) {
            if (!summary.slug) continue;
            const link = `https://www.yesplis.com/event/${summary.slug}`;
            if (isExcluded(exclusions, { externalId: summary.slug, link })) continue;
            let detail = (await fetchJson(`${YESPLIS_API_BASE}/api/v3/public/events/detail/${summary.slug}`, {
                headers: { ...headers, 'yp-page-code': link, Referer: link }
            }))?.data;
            if (Array.isArray(detail)) detail = detail[0];
            if (!detail) continue;
            const address = [detail.place_name, detail.city_name, detail.province_name].filter(Boolean).join(', ');
            const geo = await geocode(detail.address || address);
            output.push(normalize({
                externalId: summary.slug, title: detail.name, link,
                category: classify(detail.category_name, detail.sub_cat_names),
                description: `💲 ${money(detail.min_price)}\n📍 ${address || 'Lokasi belum diumumkan'}`,
                startDate: detail.start_date, endDate: detail.end_date || detail.start_date,
                images: [detail.full_path, detail.picture2_full_path, detail.picture, detail.picture2, detail.banner,
                    detail.image, detail.image_url, detail.cover, detail.poster, summary.full_path, summary.picture],
                ...geo
            }, 'yesplis'));
            if (output.length >= limit) break;
        }
        const meta = data.meta || {};
        if (meta.is_last_page || Number(meta.last_page) === page) break;
    }
    return output.filter(isUpcoming);
}

async function scrapeMichelin(limit, exclusions) {
    const endpoint = 'https://8NVHRD7ONV-dsn.algolia.net/1/indexes/prod-hotels-en/query';
    const output = [];
    for (let page = 0, pages = 1; page < pages && output.length < limit; page += 1) {
        const payload = await fetchJson(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-algolia-application-id': '8NVHRD7ONV', 'x-algolia-api-key': '3222e669cf890dc73fa5f38241117ba5', Referer: 'https://guide.michelin.com/' },
            body: JSON.stringify({ query: '', filters: 'country.slug:indonesia', hitsPerPage: 100, page })
        });
        pages = Number(payload.nbPages || 1);
        for (const hotel of payload.hits || []) {
            const link = new URL(hotel.michelin_guide_url || hotel.canonical_url || '/', 'https://guide.michelin.com').href;
            if (isExcluded(exclusions, { externalId: hotel.objectID, link })) continue;
            output.push(normalize({
                externalId: hotel.objectID, title: hotel.name, category: CATEGORIES.hotel,
                description: text(hotel.content).split(/\r?\n/).find(Boolean) || 'Pilihan akomodasi MICHELIN Guide.',
                link, startDate: '', endDate: '', lat: hotel._geoloc?.lat, lng: hotel._geoloc?.lng,
                images: [hotel.images, hotel.image, hotel.main_image, hotel.mainImage, hotel.gallery]
            }, 'michelin'));
            if (output.length >= limit) break;
        }
    }
    return output;
}

async function scrapePertamina(limit, exclusions) {
    const output = [];
    for (let page = 1; output.length < limit; page += 1) {
        const payload = await fetchJson(`https://api-stagingweb.pertaminaretail.com/location?page=${page}&limit=${Math.min(1000, limit)}`, { headers: { 'accept-language': 'en' } });
        const rows = payload.data || [];
        if (!rows.length) break;
        for (const item of rows) {
            if (isExcluded(exclusions, { externalId: item.id || item.code })) continue;
            output.push(normalize({
                externalId: item.id || item.code, title: item.name, category: CATEGORIES.spbu,
                description: buildPertaminaDescription(item),
                link: 'https://pertaminaretail.com/outlet-locator', startDate: '', endDate: '', lat: item.lat, lng: item.long,
                images: [item.images, item.image, item.photo, item.logo, item.image_url]
            }, 'pertamina'));
            if (output.length >= limit) break;
        }
        if (rows.length < Math.min(1000, limit)) break;
    }
    return output;
}

async function scrapeSpklu(limit, exclusions) {
    const rows = await fetchJson('https://petaspklu.id/api/v1/spklu/all');
    return (Array.isArray(rows) ? rows : []).filter((item) => !isExcluded(exclusions, {
        externalId: item.id
    })).slice(0, limit).map((item) => normalize({
            externalId: item.id, title: item.nama_lokasi, category: CATEGORIES.spklu,
            description: buildSpkluDescription(item),
            link: 'https://petaspklu.id/', startDate: '', endDate: '', lat: item.latitude, lng: item.longitude,
            images: [item.images, item.image, item.photo, item.logo, item.image_url]
        }, 'spklu'));
}

function pickTranslation(rows = []) { return rows.find((row) => ['ID', 'id'].includes(row.language)) || rows.find((row) => ['EN', 'en'].includes(row.language)) || rows[0] || {}; }
function detailProduct(payload) {
    const pageProps = payload?.props?.pageProps || payload?.pageProps || {};
    for (const query of pageProps?.dehydratedState?.queries || []) {
        const value = query?.state?.data;
        if (value?.code === 'SUCCESS' && value.data) return value.data;
    }
    return null;
}
function tiketDates(product) {
    const values = [];
    for (const pkg of product?.packages || []) values.push(pkg.earliestAvailabilityDate, pkg.latestAvailabilityDate);
    values.push(product?.earliestAvailabilityDate, product?.latestAvailabilityDate);
    const dates = values.map(isoDate).filter(Boolean).sort();
    return { startDate: dates[0] || '', endDate: dates.at(-1) || dates[0] || '' };
}
async function browserCrawlerOptions() {
    let proxyConfiguration;
    try { proxyConfiguration = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'], countryCode: 'ID' }); }
    catch { proxyConfiguration = await Actor.createProxyConfiguration(); }
    return {
        proxyConfiguration,
        maxConcurrency: 3,
        maxRequestRetries: 2,
        navigationTimeoutSecs: 60,
        launchContext: { launchOptions: { headless: true } },
        preNavigationHooks: [async ({ page }) => { await page.setExtraHTTPHeaders({ 'accept-language': 'id-ID,id;q=0.9,en;q=0.7' }); }]
    };
}

async function scrapeTiket(limit, exclusions) {
    const candidates = new Map();
    const details = [];
    const addTiketCardFallback = async (candidate) => {
        if (!candidate?.slug || details.some((item) => item.externalId === candidate.slug)) return;
        const dates = dateRange(candidate.dateText || candidate.cardText);
        const location = cleanTiketLocation(candidate.location);
        const price = normalizeTiketPrice(candidate.cardText);
        const geo = await geocode(location);
        const item = normalize({
            externalId: candidate.slug,
            title: candidate.title,
            description: buildTiketDescription({ price, location, startDate: dates.startDate }) || candidate.cardText,
            category: CATEGORIES.event,
            link: candidate.link,
            ...dates,
            images: candidate.cardImages,
            sourceMeta: { location, price },
            ...geo
        }, 'tiket');
        if (item.title) details.push(item);
    };
    const queue = await RequestQueue.open(`tiket-${Date.now()}`);
    await queue.addRequest({ url: 'https://www.tiket.com/en-id/to-do/search?title=&productAllCategoryCodes=EVENT', label: 'LIST' });
    const crawler = new PlaywrightCrawler({
        ...(await browserCrawlerOptions()), requestQueue: queue,
        requestHandler: async ({ page, request }) => {
            if (request.label === 'LIST') {
                await page.waitForSelector("a[href*='/to-do/']", { timeout: 25000 }).catch(() => null);
                let sawSearchCards = false;
                for (let i = 0; i < 4 && candidates.size < limit; i += 1) {
                    const cards = await page.evaluate(() => Array.from(document.querySelectorAll("a[href*='/to-do/']"))
                        .map((anchor) => {
                            const url = new URL(anchor.href);
                            url.hash = '';
                            url.search = '';
                            const match = /^\/(?:[a-z]{2}-[a-z]{2}\/)?to-do\/([^/]+)\/?$/i.exec(url.pathname);
                            if (!match || ['search', 'category'].includes(match[1].toLowerCase())) return null;
                            return {
                                link: `https://www.tiket.com/en-id/to-do/${match[1]}`,
                                slug: match[1],
                                title: anchor.querySelector('h2[title], h2')?.getAttribute('title') || anchor.querySelector('h2')?.textContent?.trim() || '',
                                dateText: anchor.querySelector('section span[title], [class*="product_info"] span[title]')?.getAttribute('title') || '',
                                location: anchor.querySelector('[class*="product_info_location"]')?.textContent?.trim() || '',
                                cardText: (anchor.textContent || '').trim(),
                                cardImages: Array.from(anchor.querySelectorAll('img'))
                                    .filter((image) => Number(image.getAttribute('width') || 0) >= 100)
                                    .map((image) => image.currentSrc || image.src)
                                    .filter(Boolean)
                            };
                        }).filter(Boolean));
                    if (cards.length) sawSearchCards = true;
                    for (const card of cards) {
                        if (!candidates.has(card.slug) && !isExcluded(exclusions, { externalId: card.slug, link: card.link })) {
                            candidates.set(card.slug, card);
                        }
                    }
                    if (candidates.size >= limit) break;
                    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    await page.waitForTimeout(1400);
                }
                if (!sawSearchCards) throw new Error('Tiket search returned no event cards');
                for (const candidate of [...candidates.values()].slice(0, limit)) {
                    await queue.addRequest({ url: candidate.link, label: 'DETAIL', userData: candidate });
                }
                return;
            }
            await page.waitForLoadState('domcontentloaded');
            await page.waitForSelector('h1', { timeout: 25000 }).catch(() => null);
            await page.waitForFunction(() => {
                const header = document.querySelector('h1')?.parentElement?.innerText || '';
                return /(?:IDR|Rp\.?)\s*[\d]/i.test(header)
                    && /\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(header);
            }, undefined, { timeout: 15000 }).catch(() => null);
            const pageData = await page.evaluate(() => {
                const nodes = [];
                const visit = (value) => {
                    if (!value) return;
                    if (Array.isArray(value)) return value.forEach(visit);
                    if (typeof value !== 'object') return;
                    if (Array.isArray(value['@graph'])) value['@graph'].forEach(visit);
                    nodes.push(value);
                };
                for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
                    try { visit(JSON.parse((script.textContent || '{}').replace(/\\'/g, "'"))); } catch {}
                }
                const schema = nodes.find((node) => {
                    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
                    return types.some((type) => typeof type === 'string' && /Event$/i.test(type));
                }) || {};
                const address = schema.location?.address;
                const addressText = typeof address === 'string'
                    ? address
                    : [address?.streetAddress, address?.addressLocality, address?.addressRegion].filter(Boolean).join(', ');
                const headerLabels = Array.from(document.querySelector('h1')?.parentElement?.querySelectorAll("[class*='ATFSection_info_label'] span") || [])
                    .map((element) => (element.innerText || element.textContent || '').trim())
                    .filter(Boolean);
                return {
                    title: schema.name || document.querySelector('h1')?.textContent?.trim() || document.querySelector('meta[property="og:title"]')?.content || '',
                    startDate: schema.startDate || '',
                    endDate: schema.endDate || schema.startDate || '',
                    location: addressText || schema.location?.name || '',
                    lat: schema.location?.geo?.latitude,
                    headerLocation: headerLabels[0] || '',
                    headerDate: headerLabels.find((value) => /\d{1,2}\s+[A-Za-z]+\s+\d{4}/.test(value)) || '',
                    price: headerLabels.find((value) => /(?:IDR|Rp\.?)\s*[\d]/i.test(value)) || schema.offers?.price || '',
                    lng: schema.location?.geo?.longitude,
                    images: [
                        schema.image,
                        document.querySelector('meta[property="og:image"]')?.content,
                        ...Array.from(document.images).map((image) => image.currentSrc || image.src)
                    ].filter(Boolean).slice(0, 8)
                };
            });
            const cardDates = dateRange(request.userData.dateText || request.userData.cardText);
            const headerDates = dateRange(pageData.headerDate);
            const schemaDates = dateRange([pageData.startDate, pageData.endDate].filter(Boolean).join(' '));
            const startDate = headerDates.startDate || cardDates.startDate || schemaDates.startDate;
            const endDate = headerDates.endDate || cardDates.endDate || schemaDates.endDate;
            const location = cleanTiketLocation(pageData.headerLocation || pageData.location || request.userData.location || '');
            const price = normalizeTiketPrice(pageData.price || request.userData.cardText);
            const geo = await geocode(location);
            const lat = geo.lat ?? numeric(pageData.lat);
            const lng = geo.lng ?? numeric(pageData.lng);
            const item = normalize({
                externalId: request.userData.slug,
                title: pageData.title || request.userData.title,
                description: buildTiketDescription({ price, location, startDate }) || request.userData.cardText,
                category: CATEGORIES.event,
                link: request.userData.link || request.url,
                startDate,
                endDate,
                lat,
                lng,
                images: [request.userData.cardImages, pageData.images],
                sourceMeta: { location, price }
            }, 'tiket');
            if (item.title && !details.some((entry) => entry.externalId === item.externalId)) details.push(item);
        },
        failedRequestHandler: async ({ request }) => {
            if (request.label === 'DETAIL') await addTiketCardFallback(request.userData);
        }
    });
    await crawler.run();
    return details.filter(isUpcoming).slice(0, limit);
}

async function scrapeIndorelawan(limit, exclusions) {
    const links = [];
    const output = [];
    const queue = await RequestQueue.open(`indorelawan-${Date.now()}`);
    await queue.addRequest({ url: 'https://www.indorelawan.org/activity/search?page=1&filters=location_type%3Afixed', label: 'LIST', userData: { page: 1 } });
    const crawler = new PlaywrightCrawler({
        ...(await browserCrawlerOptions()), requestQueue: queue, maxConcurrency: 2,
        requestHandler: async ({ page, request }) => {
            if (request.label === 'LIST') {
                await page.waitForSelector("a[href*='/activity/']", { timeout: 25000 }).catch(() => null);
                const pageLinks = await page.locator("a[href*='/activity/']").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.href))]);
                for (const link of pageLinks) {
                    if (!links.includes(link) && !isExcluded(exclusions, { link }) && links.length < limit) links.push(link);
                }
                if (pageLinks.length && links.length < limit && request.userData.page < 20) {
                    const next = request.userData.page + 1;
                    await queue.addRequest({ url: `https://www.indorelawan.org/activity/search?page=${next}&filters=location_type%3Afixed`, label: 'LIST', userData: { page: next } });
                } else for (const link of links.slice(0, limit)) await queue.addRequest({ url: link, label: 'DETAIL' });
                return;
            }
            await page.waitForSelector('h1', { timeout: 25000 });
            const data = await page.evaluate(() => {
                const body = document.body.innerText;
                const title = document.querySelector('h1')?.textContent?.trim() || '';
                const period = body.match(/Periode Aktivitas\s*\n([^\n]+)/i)?.[1] || '';
                const domicile = body.match(/Domisili\s*\n([^\n]+)/i)?.[1] || '';
                const images = Array.from(document.images)
                    .map((image) => image.currentSrc || image.src)
                    .filter((source) => /uploads(?:\/|%2f)gallery/i.test(source));
                if (!images.length) images.push(document.querySelector('meta[property="og:image"]')?.content || '');
                return { title, period, domicile, description: body.slice(0, 5000), images };
            });
            const dates = data.period.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4}/g) || [];
            const geo = await geocode(data.domicile);
            output.push(normalize({ title: data.title, description: data.description, category: CATEGORIES.social, link: request.url, startDate: dates[0], endDate: dates.at(-1) || dates[0], images: data.images, ...geo }, 'indorelawan'));
        }
    });
    await crawler.run();
    return output.filter(isUpcoming).slice(0, limit);
}

async function scrapeKalenderLari(limit, exclusions) {
    const output = [];
    const queue = await RequestQueue.open(`kalenderlari-${Date.now()}`);
    await queue.addRequest({ url: 'https://kalenderlari.com/events/', label: 'LIST' });
    const crawler = new PlaywrightCrawler({
        ...(await browserCrawlerOptions()), requestQueue: queue, maxConcurrency: 2,
        requestHandler: async ({ page, request }) => {
            if (request.label === 'LIST') {
                await page.waitForSelector("a[href*='/events/']", { timeout: 25000 }).catch(() => null);
                const links = await page.locator("a[href*='/events/']").evaluateAll((nodes) => [...new Set(nodes.map((node) => {
                    const url = new URL(node.href);
                    url.hash = '';
                    url.search = '';
                    return /^\/events\/[^/]+\/?$/i.test(url.pathname) ? url.href.replace(/\/$/, '') : '';
                }).filter(Boolean))]);
                let queued = 0;
                for (const link of links) {
                    const slug = new URL(link).pathname.split('/').filter(Boolean).at(-1) || '';
                    if (isExcluded(exclusions, { externalId: slug, link })) continue;
                    await queue.addRequest({ url: link, label: 'DETAIL', userData: { slug } });
                    queued += 1;
                    if (queued >= limit) break;
                }
                return;
            }
            await page.waitForSelector('h1', { timeout: 25000 }).catch(() => null);
            const data = await page.evaluate(() => {
                const nodes = [];
                const visit = (value) => {
                    if (!value) return;
                    if (Array.isArray(value)) return value.forEach(visit);
                    if (typeof value !== 'object') return;
                    if (Array.isArray(value['@graph'])) value['@graph'].forEach(visit);
                    nodes.push(value);
                };
                for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
                    try { visit(JSON.parse((script.textContent || '{}').replace(/\\'/g, "'"))); } catch {}
                }
                const schema = nodes.find((node) => {
                    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
                    return types.includes('Event');
                }) || {};
                const address = schema.location?.address;
                const addressText = typeof address === 'string'
                    ? address
                    : [address?.streetAddress, address?.addressLocality, address?.addressRegion].filter(Boolean).join(', ');
                const description = schema.description
                    || document.querySelector('.mec-single-event-description, .entry-content, article')?.innerHTML
                    || document.querySelector('meta[property="og:description"]')?.content
                    || '';
                const domLocation = document.querySelector('.mec-single-event-location')?.textContent?.replace(/^\s*Location\s*/i, '').trim() || '';
                const domStartDate = document.querySelector('.mec-single-event-date .mec-start-date-label, .mec-start-date-label')?.textContent?.trim() || '';
                const domEndDate = document.querySelector('.mec-single-event-date .mec-end-date-label, .mec-end-date-label')?.textContent?.trim() || domStartDate;
                const kalenderLariHost = window.location.hostname.replace(/^www\./i, '').toLowerCase();
                const originalLinkCandidates = [
                    ...document.querySelectorAll('.mec-more-info-button[href], .mec-booking-button[href], .mec-events-event-more-info a[href]')
                ].map((anchor) => anchor.href);
                const schemaOffers = Array.isArray(schema.offers) ? schema.offers : [schema.offers];
                schemaOffers.filter(Boolean).forEach((offer) => originalLinkCandidates.push(offer.url));
                const originalLink = originalLinkCandidates.find((candidate) => {
                    try {
                        const url = new URL(candidate, window.location.href);
                        return ['http:', 'https:'].includes(url.protocol)
                            && url.hostname.replace(/^www\./i, '').toLowerCase() !== kalenderLariHost;
                    } catch {
                        return false;
                    }
                }) || '';
                return {
                    title: schema.name || document.querySelector('h1, .mec-single-title')?.textContent?.trim() || document.title,
                    startDate: schema.startDate || domStartDate,
                    endDate: schema.endDate || schema.startDate || domEndDate,
                    location: [...new Set([schema.location?.name, addressText].filter(Boolean))].join(', ') || domLocation,
                    lat: schema.location?.geo?.latitude,
                    lng: schema.location?.geo?.longitude,
                    originalLink,
                    description,
                    images: [
                        schema.image,
                        schema.location?.image,
                        document.querySelector('meta[property="og:image"]')?.content,
                        document.querySelector('main img, article img')?.src
                    ].filter(Boolean)
                };
            });
            const dates = dateRange([data.startDate, data.endDate].filter(Boolean).join(' '));
            const schemaLat = numeric(data.lat);
            const schemaLng = numeric(data.lng);
            const geo = schemaLat !== null && schemaLng !== null
                ? { lat: schemaLat, lng: schemaLng }
                : await geocode(data.location);
            const item = normalize({
                externalId: request.userData.slug,
                title: data.title,
                description: data.description,
                category: CATEGORIES.sport,
                link: data.originalLink || request.url,
                ...dates,
                images: data.images,
                sourceMeta: { location: data.location, kalenderLariLink: request.url },
                ...geo
            }, 'kalenderlari');
            if (item.title) output.push(item);
        }
    });
    await crawler.run();
    return output.filter(isUpcoming).slice(0, limit);
}

const SCRAPERS = { tiket: scrapeTiket, loket: scrapeLoket, yesplis: scrapeYesplis, indorelawan: scrapeIndorelawan, kalenderlari: scrapeKalenderLari, michelin: scrapeMichelin, pertamina: scrapePertamina, spklu: scrapeSpklu };

await Actor.main(async () => {
    const input = await Actor.getInput() || {};
    const source = text(input.source).toLowerCase();
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 500);
    const exclusions = createExclusions(input);
    try {
        if (!SCRAPERS[source]) throw new Error(`Unsupported source: ${source}`);
        const items = await SCRAPERS[source](limit, exclusions);
        if (items.length) await Actor.pushData(items.slice(0, limit));
        console.log(`Gathered ${items.length} new ${source} item(s); skipped against ${exclusions.externalIds.size} known IDs and ${exclusions.links.size} known links.`);
    } catch (error) {
        const statusMessage = actorFailureMessage(source, error);
        await Actor.setStatusMessage(statusMessage, { isStatusMessageTerminal: true, level: 'ERROR' }).catch(() => {});
        throw error;
    }
});
