#!/usr/bin/env node
// Verify LuCI class-factory contracts, which `node --check` alone cannot catch.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resources = path.resolve(__dirname,
  '../../package/airrelay/luci-theme-airrelay/htdocs/luci-static/resources');

function BaseClass() {}
BaseClass.extend = function(properties) {
  function Subclass() {}
  Subclass.prototype = Object.create(this.prototype);
  Object.assign(Subclass.prototype, properties);
  return Subclass;
};
BaseClass.isSubclass = function(value) {
  return typeof value === 'function' && value.prototype instanceof this;
};

let now = 1000;
const dependencies = {
  _: value => value,
  baseclass: BaseClass,
  view: BaseClass,
  rpc: { declare: () => () => Promise.resolve({}) },
  form: {}, uci: {}, poll: {}, fs: {}, ui: {},
  Date: { now: () => now }
};

function loadModule(file) {
  const source = fs.readFileSync(path.join(resources, file), 'utf8');
  const names = Object.keys(dependencies);
  const constructor = new Function(...names, source)(...names.map(n => dependencies[n]));
  assert.ok(BaseClass.isSubclass(constructor),
    `${file}: LuCI factory must return a baseclass subclass constructor`);
  return new constructor();
}

dependencies.traffic = loadModule('airrelay/traffic.js');
dependencies.wireguard = loadModule('airrelay/wireguard.js');
dependencies.systemManager = loadModule('airrelay/system.js');
dependencies.agentState = loadModule('airrelay/agent-state.js');
dependencies.wgConfig = loadModule('airrelay/wg-config.js');

const traffic = dependencies.traffic;
assert.equal(traffic.bytes(1024), '1.0 KB');
assert.equal(traffic.bytes(-1), '—');

const sample = traffic.tracker();
assert.deepEqual(sample('wg0', { statistics: { rx_bytes: 1000, tx_bytes: 2000 } }),
  { rx: 1000, tx: 2000, rxRate: null, txRate: null });
now += 5000;
assert.deepEqual(sample('wg0', { statistics: { rx_bytes: 1500, tx_bytes: 2300 } }),
  { rx: 1500, tx: 2300, rxRate: 100, txRate: 60 });
assert.equal(sample('wg1', {}), null);

// Historical counters survive navigation because they come from the device.
const rows = Array.from({ length: 241 }, (_, i) => `${i * 15} ${i * 1500} ${i * 3000}`).join('\n');
const history = traffic.history(rows, 3600);
assert.equal(history.length, 241);
assert.equal(history[1].rxRate, 100);
assert.equal(history[240].txRate, 200);
assert.equal(traffic.history(rows, 7201).length, 0);
assert.deepEqual(traffic.history('malformed', 3600), []);
assert.deepEqual(traffic.history(rows, undefined), []);
assert.equal(traffic.history('0 100 100\n15 50 50', 15)[1].rxRate, null);
assert.equal(traffic.history('0 100 100\n60 200 200', 60)[1].rxRate, null);
assert.equal(traffic.history('0 100 100\nbad\n15 200 200', 15)[1].rxRate, null);
assert.equal(traffic.history('30 100 100', 15).length, 0);
assert.match(traffic.linePath(history, 'rx', 3600), /^ M1\.3,13\.0 L/);
const gap = traffic.history('0 0 0\n15 150 150\n75 300 300\n90 450 450', 90);
assert.equal((traffic.linePath(gap, 'rx', 90).match(/M/g) || []).length, 2);

for (const file of fs.readdirSync(path.join(resources, 'view/airrelay')))
  if (file.endsWith('.js')) loadModule(`view/airrelay/${file}`);

console.log('AirRelay LuCI modules: factory contracts and traffic sampling OK');
