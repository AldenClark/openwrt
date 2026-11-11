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

for (const file of fs.readdirSync(path.join(resources, 'view/airrelay')))
  if (file.endsWith('.js')) loadModule(`view/airrelay/${file}`);

console.log('AirRelay LuCI modules: factory contracts and traffic sampling OK');
