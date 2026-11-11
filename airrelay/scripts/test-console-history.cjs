#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.resolve(__dirname,
  '../../package/airrelay/luci-theme-airrelay/root/usr/libexec/airrelay-traffic'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airrelay-history-'));
try {
  fs.mkdirSync(path.join(dir, 'store'));
  fs.writeFileSync(path.join(dir, 'store/history'), Array.from({length: 241}, (_, i) => `${i * 15} ${i} ${i}\n`).join(''));
  fs.writeFileSync(path.join(dir, 'uptime'), '3615.50 0.00\n');
  fs.writeFileSync(path.join(dir, 'rx'), '10000\n');
  fs.writeFileSync(path.join(dir, 'tx'), '20000\n');
  // Exercise the actual shell collector for one iteration with fixture counters.
  const script = source.replace('store=/tmp/airrelay-traffic', `store=${dir}/store`)
    .replace('/proc/uptime', `${dir}/uptime`)
    .replace('/sys/class/net/br-lan/statistics/rx_bytes', `${dir}/rx`)
    .replace('/sys/class/net/br-lan/statistics/tx_bytes', `${dir}/tx`)
    .replace('sleep 15 &\n    wait $!', 'exit 0');
  let result = spawnSync('sh', ['-c', script], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  let lines = fs.readFileSync(path.join(dir, 'store/history'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 241);
  assert.equal(lines[0], '15 1 1');
  assert.equal(lines.at(-1), '3615 10000 20000');
  assert.equal(fs.existsSync(path.join(dir, 'store/history.new')), false);
  // Missing / invalid counters must not overwrite valid historical samples.
  fs.writeFileSync(path.join(dir, 'rx'), 'bad counter\n');
  result = spawnSync('sh', ['-c', script], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'store/history'), 'utf8').trim().split('\n'), lines);
  fs.unlinkSync(path.join(dir, 'rx'));
  result = spawnSync('sh', ['-c', script], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'store/history'), 'utf8').trim().split('\n'), lines);
  console.log('AirRelay history collector: bounded retention, atomic snapshot and invalid counters OK');
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
