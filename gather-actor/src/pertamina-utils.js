function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function formatDetailLines(value) {
    const values = Array.isArray(value) ? value : [value];
    const lines = values.flatMap((entry) => text(entry).split(/\r?\n|\s*[,;]\s*/));
    return lines.map((line) => line.trim()).filter(Boolean);
}

export function buildPertaminaDescription(item = {}) {
    const fuels = formatDetailLines(item.fuel);
    const facilities = formatDetailLines(item.facility);

    return [
        `🕓 Jam Operasional : ${text(item.operational_hour) || '-'}`,
        '',
        '🛢️ Bahan Bakar :',
        ...(fuels.length ? fuels : ['-']),
        '',
        '🏪 Fasilitas :',
        ...(facilities.length ? facilities : ['-'])
    ].join('\n');
}
