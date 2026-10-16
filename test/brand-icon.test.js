'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPng(file, width, height) {
  const buf = fs.readFileSync(path.join(root, file));
  assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${file} is a PNG`);
  assert.equal(buf.readUInt32BE(16), width, `${file} width`);
  assert.equal(buf.readUInt32BE(20), height, `${file} height`);
  return buf;
}

test('dapp.json declares the icon image and keeps the emoji fallback', () => {
  const dapp = JSON.parse(fs.readFileSync(path.join(root, 'dapp.json'), 'utf8'));
  assert.equal(dapp.icon.image, 'brand/icon.png');
  assert.equal(dapp.icon.emoji, '🐌');
});

test('app icon is a 1024x1024 PNG under the 256 KB platform limit', () => {
  const buf = readPng('brand/icon.png', 1024, 1024);
  assert.ok(buf.length <= 256 * 1024, `icon.png is ${buf.length} bytes, limit is ${256 * 1024}`);
});

test('featured icons exist in both light and dark versions', () => {
  readPng('brand/featured-light.png', 1920, 1080);
  readPng('brand/featured-dark.png', 1920, 1080);
});

test('brand SVGs use only brand colours and stay flat', () => {
  const palette = new Set([
    '#FFFEEA', '#FFEE6F', '#3090E1', '#A9CF97',
    '#FFFFFF', '#FCFAB3', '#000000', '#B9B9B9',
  ]);
  for (const file of ['brand/icon.svg', 'brand/featured-light.svg', 'brand/featured-dark.svg']) {
    const svg = fs.readFileSync(path.join(root, file), 'utf8').toLowerCase();
    const colors = svg.match(/#[0-9a-f]{6}/g) || [];
    for (const color of colors) {
      assert.ok(palette.has(color.toUpperCase()), `${file} uses off-palette colour ${color}`);
    }
    for (const banned of ['lineargradient', 'radialgradient', '<filter', '<text']) {
      assert.ok(!svg.includes(banned), `${file} contains ${banned}`);
    }
  }
});
