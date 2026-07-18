const test = require('node:test');
const assert = require('node:assert/strict');
const { detectImageType, imageFilename, isUploadFilename } = require('../lib/image-validation');

test('detects allowed image signatures', () => {
    assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
    assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
    assert.equal(detectImageType(Buffer.from('GIF89a')), 'image/gif');
    assert.equal(detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
});

test('rejects non-image bytes', () => {
    assert.equal(detectImageType(Buffer.from('<svg></svg>')), null);
    assert.equal(detectImageType(Buffer.from('not an image')), null);
});

test('uses only server-generated upload filenames', () => {
    const filename = imageFilename('image/png');
    assert.equal(isUploadFilename(filename), true);
    assert.equal(isUploadFilename('../secret.png'), false);
    assert.equal(isUploadFilename('photo.svg'), false);
});
