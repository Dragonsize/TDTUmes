const crypto = require('crypto');
const path = require('path');

const IMAGE_TYPES = {
    'image/png': { extension: '.png', matches: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    'image/jpeg': { extension: '.jpg', matches: buffer => buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) },
    'image/gif': { extension: '.gif', matches: buffer => buffer.length >= 6 && (buffer.subarray(0, 6).equals(Buffer.from('GIF87a')) || buffer.subarray(0, 6).equals(Buffer.from('GIF89a'))) },
    'image/webp': { extension: '.webp', matches: buffer => buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from('RIFF')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP')) }
};

function detectImageType(buffer) {
    return Object.entries(IMAGE_TYPES).find(([, type]) => type.matches(buffer))?.[0] || null;
}

function imageFilename(mimeType) {
    return `${crypto.randomUUID()}${IMAGE_TYPES[mimeType].extension}`;
}

function isUploadFilename(filename) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/i.test(path.basename(filename));
}

module.exports = { IMAGE_TYPES, detectImageType, imageFilename, isUploadFilename };
