#!/usr/bin/env node
// Regression tests for the AirRelay firmware picker and the LuCI upgrade RPCs.
// The real flash operation is never performed by these tests.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname,
  '../../package/airrelay/luci-theme-airrelay/htdocs/luci-static/resources/view/airrelay/upgrade.js'), 'utf8');
const firmwarePath = '/tmp/firmware.bin';

function verifyPackagedUpgradeContract() {
  const repo = path.resolve(__dirname, '../..');
  const menu = JSON.parse(fs.readFileSync(path.join(repo,
    'package/airrelay/luci-theme-airrelay/root/usr/share/luci/menu.d/airrelay-console.json'), 'utf8'));
  assert.ok(menu['admin/airrelay/upgrade'].depends.acl.includes('luci-mod-system-flash'));

  for (const [subtarget, model] of [ ['an7581', 'md'], ['an7583', 'mf'] ]) {
    const config = fs.readFileSync(path.join(repo, `airrelay/configs/${model}.config`), 'utf8');
    assert.match(config, /^CONFIG_PACKAGE_luci-mod-admin-full=y$/m);

    const platform = fs.readFileSync(path.join(repo,
      `target/linux/airoha/${subtarget}/base-files/lib/upgrade/platform.sh`), 'utf8');
    assert.ok(platform.includes(`nokia,xg-040g-${model}-ubi`));
    assert.ok(platform.includes('fit_check_image "$1"'));
    assert.ok(platform.includes('fit_do_upgrade "$1"'));
  }

  // In CI the LuCI feed is installed before this test. Ensure that its
  // server-side ACL still permits each RPC required by this custom page.
  const aclFile = path.join(repo,
    'feeds/luci/modules/luci-mod-system/root/usr/share/rpcd/acl.d/luci-mod-system.json');
  if (fs.existsSync(aclFile)) {
    const acl = JSON.parse(fs.readFileSync(aclFile, 'utf8'))['luci-mod-system-flash'];
    for (const command of [
      '/sbin/sysupgrade --test /tmp/firmware.bin',
      '/sbin/sysupgrade /tmp/firmware.bin',
      '/sbin/sysupgrade -n /tmp/firmware.bin'
    ]) assert.ok(acl.write.file[command]?.includes('exec'), `Missing ACL: ${command}`);
    assert.ok(acl.write.file['/tmp/firmware.bin']?.includes('write'));
    assert.ok(acl.write.ubus['cgi-io']?.includes('upload') || acl.write['cgi-io']?.includes('upload'));
    assert.ok(acl.write.ubus.system?.includes('validate_firmware_image'));
    assert.ok(acl.write.ubus.file?.includes('remove'));
  }
}

function element(tag, attributes, children) {
  if (children === undefined && (attributes == null || typeof attributes !== 'object' || Array.isArray(attributes))) {
    children = attributes;
    attributes = {};
  }
  const node = {
    tag, attributes: attributes || {},
    children: [ children ].flat(Infinity).filter(c => c != null && c !== ''),
    disabled: !!attributes?.disabled,
    checked: !!attributes?.checked
  };
  if (typeof node.attributes.click === 'function')
    node.click = () => node.attributes.click({ currentTarget: node, target: node });
  return node;
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function button(root, label) {
  const result = findNode(root, n => n.tag === 'button' && n.children.includes(label));
  assert.ok(result, `Missing button: ${label}`);
  return result;
}

function makeHarness(options = {}) {
  const calls = [], modals = [], notifications = [], reconnects = [];
  const upload = options.upload ?? { name: 'xg-040g-mf-ubi-sysupgrade.itb', size: 8560916, sha256sum: 'test-sha256' };
  const validation = options.validation ?? { valid: true, allow_backup: true };

  const file = {
    exec(program, args) {
      calls.push([ 'exec', program, ...args ]);
      if (args[0] === '--test')
        return Promise.resolve(options.testResult ?? { code: 0, stderr: '' });
      return Promise.resolve(options.installResult ?? { code: 0, stderr: '' });
    },
    remove(target) {
      calls.push([ 'remove', target ]);
      return Promise.resolve();
    }
  };

  const ui = {
    uploadFile(target) {
      calls.push([ 'upload', target ]);
      return options.uploadError ? Promise.reject(options.uploadError) : Promise.resolve(upload);
    },
    showModal(title, children) { modals.push({ title, children }); },
    hideModal() { calls.push([ 'hideModal' ]); },
    addNotification(_title, content) { notifications.push(content); },
    awaitReconnect(...hosts) { reconnects.push(hosts); },
    createHandlerFn(ctx, name, ...args) {
      return event => {
        const target = event.currentTarget;
        target.disabled = true;
        return Promise.resolve().then(() => ctx[name](...args, event)).finally(() => { target.disabled = false; });
      };
    }
  };
  const rpc = {
    declare(spec) {
      assert.equal(spec.object, 'system');
      assert.equal(spec.method, 'validate_firmware_image');
      return target => {
        calls.push([ 'validate', target ]);
        return options.validationError ? Promise.reject(options.validationError) : Promise.resolve(validation);
      };
    }
  };
  const view = { extend(definition) { return definition; } };
  const page = new Function('view', 'rpc', 'fs', 'ui', 'L', 'E', '_', 'window', source)(
    view, rpc, file, ui, { hasViewPermission: () => options.canWrite ?? false },
    element, value => value, { location: { host: '192.168.1.3' } }
  );

  return {
    page, calls, modals, notifications, reconnects,
    lastModal() { return modals[modals.length - 1]; }
  };
}

async function test() {
  verifyPackagedUpgradeContract();
  // Read-only view hints or missing platform.sh stat must not block the file
  // picker. Authorization is enforced by cgi-io and rpcd on the actual device.
  {
    const ctx = makeHarness({ canWrite: false });
    const select = button(ctx.page.render(), 'Choose firmware…');
    assert.equal(select.disabled, false);
    await select.click();
    assert.deepEqual(ctx.calls.slice(0, 3), [
      [ 'upload', firmwarePath ],
      [ 'validate', firmwarePath ],
      [ 'exec', '/sbin/sysupgrade', '--test', firmwarePath ]
    ]);
    assert.equal(ctx.lastModal().title, 'Confirm firmware upgrade');
    assert.ok(findNode(ctx.lastModal().children, n => n.tag === 'code'));
    assert.equal(select.disabled, false);
    await button(ctx.lastModal().children, 'Install firmware').click();
    assert.ok(ctx.calls.some(c => c.join('|') === `exec|/sbin/sysupgrade|${firmwarePath}`));
    assert.deepEqual(ctx.reconnects, [[ '192.168.1.3' ]]);
  }

  // Disabling configuration preservation must use exactly -n, not --force.
  {
    const ctx = makeHarness();
    await button(ctx.page.render(), 'Choose firmware…').click();
    const keep = findNode(ctx.lastModal().children, n => n.tag === 'input' && n.attributes.type === 'checkbox');
    assert.ok(keep && keep.checked);
    keep.checked = false;
    await button(ctx.lastModal().children, 'Install firmware').click();
    assert.ok(ctx.calls.some(c => c.join('|') === `exec|/sbin/sysupgrade|-n|${firmwarePath}`));
    assert.deepEqual(ctx.reconnects, [[ '192.168.1.3' ]]);
  }

  // An image failing either validation step never presents an install action.
  for (const conditions of [
    { validation: { valid: false, allow_backup: false } },
    { testResult: { code: 74, stderr: 'Image check failed' } }
  ]) {
    const ctx = makeHarness(conditions);
    await button(ctx.page.render(), 'Choose firmware…').click();
    assert.equal(ctx.lastModal().title, 'Firmware not supported');
    assert.equal(findNode(ctx.lastModal().children, n => n.tag === 'button' && n.children.includes('Install firmware')), null);
    await button(ctx.lastModal().children, 'Close').click();
    assert.ok(ctx.calls.some(c => c.join('|') === `remove|${firmwarePath}`));
  }

  // A non-backup-compatible image offers a safe clean upgrade only.
  {
    const ctx = makeHarness({ validation: { valid: true, allow_backup: false } });
    await button(ctx.page.render(), 'Choose firmware…').click();
    const keep = findNode(ctx.lastModal().children, n => n.tag === 'input');
    assert.equal(keep.disabled, true);
    assert.equal(keep.checked, false);
  }

  // Cancelled uploads must not produce an alarming error toast.
  {
    const ctx = makeHarness({ uploadError: new Error('Upload has been cancelled') });
    await button(ctx.page.render(), 'Choose firmware…').click();
    assert.equal(ctx.notifications.length, 0);
    assert.equal(ctx.calls.some(c => c[0] === 'exec'), false);
  }

  // RPC errors and installation failures should be visible; no forced flash.
  {
    const ctx = makeHarness({ validationError: new Error('Access denied') });
    await button(ctx.page.render(), 'Choose firmware…').click();
    assert.equal(ctx.notifications.length, 1);
    assert.equal(ctx.calls.some(c => c[0] === 'exec'), false);
  }
  {
    const ctx = makeHarness({ installResult: { code: 1, stderr: 'upgrade rejected' } });
    await button(ctx.page.render(), 'Choose firmware…').click();
    await button(ctx.lastModal().children, 'Install firmware').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.lastModal().title, 'Firmware upgrade command failed.');
    assert.equal(ctx.calls.some(c => c.includes('--force') || c.includes('-F')), false);
  }

  console.log('AirRelay firmware upgrade: picker, upload, validation, cancel, and flash RPC flow OK');
}

test().catch(err => { console.error(err); process.exitCode = 1; });
