function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function numeric(value) {
    if (value === null || value === '' || typeof value === 'undefined') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatSpkluChargeType(value) {
    const normalized = text(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const labels = {
        ultrafast: 'Ultra Fast',
        'ultra fast': 'Ultra Fast',
        fast: 'Fast',
        medium: 'Medium',
        standard: 'Standard'
    };
    if (labels[normalized]) return labels[normalized];
    return normalized ? normalized.replace(/\b\w/g, (char) => char.toUpperCase()) : '-';
}

export function buildSpkluDescription(item = {}) {
    const chargerBoxes = Array.isArray(item.chargerboxes) ? item.chargerboxes : [];
    const reportedTotal = numeric(item.total_charger);
    const chargerBoxTotal = chargerBoxes.reduce((sum, box) => sum + Math.max(numeric(box?.jumlah_charger) || 0, 0), 0);
    const totalCharger = reportedTotal !== null && reportedTotal > 0
        ? reportedTotal
        : (chargerBoxTotal > 0 ? chargerBoxTotal : null);
    const chargerBoxLines = chargerBoxes.map((box) => {
        const count = numeric(box?.jumlah_charger);
        return `- ${formatSpkluChargeType(box?.type_charge)} | ${text(box?.watt) || '-'} | ${count === null ? '-' : formatNumber(count)}`;
    });

    return [
        `⚡ Daya Max: ${text(item.watt) || '-'}`,
        `🔌 Total Charger: ${totalCharger === null ? '-' : formatNumber(totalCharger)}`,
        '⛽ Charger Box Tersedia:',
        ...(chargerBoxLines.length ? chargerBoxLines : ['- Tidak ada data charger box'])
    ].join('\n');
}
