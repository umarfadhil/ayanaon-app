const MONTH_NAMES_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];
const WEEKDAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function cleanTiketLocation(value) {
    const firstLine = String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    const normalized = firstLine.replace(/\s+/g, ' ').trim();
    const countryIndex = normalized.toLowerCase().indexOf(', indonesia');
    return countryIndex >= 0
        ? normalized.slice(0, countryIndex + ', Indonesia'.length)
        : normalized;
}

export function normalizeTiketPrice(value) {
    const match = /(?:IDR|Rp\.?)\s*([\d.,]+)/i.exec(String(value || ''));
    return match ? `IDR ${match[1]}` : '';
}

export function formatTiketDateId(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(date.getTime())) return '';
    return `${WEEKDAY_NAMES_ID[date.getUTCDay()]}, ${Number(match[3])} ${MONTH_NAMES_ID[Number(match[2]) - 1]} ${match[1]}`;
}

export function buildTiketDescription({ price, location, startDate }) {
    const detailLines = [];
    if (price) detailLines.push(`\u{1F4B2} Mulai dari ${price}`);
    if (location) detailLines.push(`\u{1F4CD} ${location}`);
    const date = formatTiketDateId(startDate);
    return [detailLines.join('\n'), date ? `\u{1F4C5} ${date}` : ''].filter(Boolean).join('\n\n');
}
