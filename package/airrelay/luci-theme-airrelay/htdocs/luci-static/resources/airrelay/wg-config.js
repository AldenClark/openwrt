'use strict';
'require baseclass';
'require form';
'require uci';
'require ui';
'require rpc';
'require airrelay.agent-state as agentState';

const publicKey = rpc.declare({ object: 'luci.wireguard', method: 'getPublicAndPrivateKeyFromPrivate', params: [ 'privkey' ], expect: { keys: {} } });

function keyValid(_id, value) {
  return !value || (/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(value) && !/^A{43}=$/.test(value))
    ? true : _('Enter a valid WireGuard key.');
}

function list(value) { return Array.isArray(value) ? value : value ? [ value ] : []; }
const peerDefaults = { route_allowed_ips: '1', persistent_keepalive: '25' };

function concealed(option) {
  option.password = true;
  const render = option.renderWidget;
  option.renderWidget = function(...args) {
    const node = render.apply(this, args);
    node.querySelectorAll('.control-group > button').forEach(button => button.remove());
    return node;
  };
}

function defaultRoute(value) { return /\/(?:0|0\.0\.0\.0)$/.test(value); }

// Keep existing assignments and user firewall rules. Only provision missing
// exit-node membership/forwarding and our own explicit UDP listener rules.
function provision(names) {
  const zones = uci.sections('firewall', 'zone');
  const uplink = zones.find(z => list(z.network).includes('lan'));
  if (!uplink) throw new Error(_('No firewall zone is assigned to the management interface.'));
  // Preflight all names and routes before changing any firewall state.
  for (const name of names) {
    const id = 'airrelay_wg_' + name;
    const existing = uci.get('firewall', id);
    if (existing && (existing['.type'] !== 'rule' || existing.name !== 'AirRelay WireGuard ' + name))
      throw new Error(_('A firewall rule name is already in use.'));
    if (uci.sections('network', 'wireguard_' + name).some(peer => list(peer.allowed_ips).some(defaultRoute)))
      throw new Error(_('Keep the management default route outside WireGuard.'));
  }
  for (const name of names) {
    if (uci.get('network', name, 'proto') !== 'wireguard') continue;
    for (const peer of uci.sections('network', 'wireguard_' + name))
      for (const [key, value] of Object.entries(peerDefaults))
        uci.set('network', peer['.name'], key, value);
    let zone = uci.sections('firewall', 'zone').find(z => list(z.network).includes(name));
    if (!zone) {
      zone = uci.sections('firewall', 'zone').find(z => z.name === 'tunnel' || z.name === 'airrelay_wg');
      if (!zone) {
        const id = uci.add('firewall', 'zone');
        for (const [key, value] of Object.entries({ name: 'airrelay_wg', input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' }))
          uci.set('firewall', id, key, value);
        zone = { '.name': id, name: 'airrelay_wg', network: [] };
      }
      uci.set('firewall', zone['.name'], 'network', [ ...list(zone.network), name ]);
      if (!uci.sections('firewall', 'forwarding').some(f => f.src === zone.name && f.dest === uplink.name)) {
        const id = uci.add('firewall', 'forwarding');
        uci.set('firewall', id, 'src', zone.name);
        uci.set('firewall', id, 'dest', uplink.name);
      }
      uci.set('firewall', uplink['.name'], 'masq', '1');
    }
    const id = 'airrelay_wg_' + name;
    const port = uci.get('network', name, 'listen_port');
    if (port && uplink.input !== 'ACCEPT') {
      const existing = uci.get('firewall', id);
      if (!existing) uci.add('firewall', 'rule', id);
      for (const [key, value] of Object.entries({ name: 'AirRelay WireGuard ' + name, src: uplink.name,
        proto: 'udp', dest_port: port, target: 'ACCEPT', family: 'ipv4',
        enabled: uci.get('network', name, 'disabled') === '1' ? '0' : '1' }))
        uci.set('firewall', id, key, value);
    }
    else if (uci.get('firewall', id, 'name') === 'AirRelay WireGuard ' + name)
      uci.remove('firewall', id);
  }
}

function fields(map, name) {
  const exists = uci.get('network', name, 'proto') === 'wireguard';
  const section = map.section(form.NamedSection, name, 'interface', name);
  section.addremove = !exists;
  section.addbtntitle = _('Create tunnel');
  section.handleAdd = async function() {
    await agentState.assertManual();
    if (uci.get('network', name)) throw new Error(_('Interface name is already in use.'));
    uci.add('network', 'interface', name);
    uci.set('network', name, 'proto', 'wireguard');
    uci.set('network', name, 'tunlink', 'lan');
    uci.set('network', name, 'listen_port', '51820');
    return map.save(null, true);
  };
  let o = section.option(form.Flag, 'disabled', _('Enable tunnel'));
  o.enabled = '0'; o.disabled = '1'; o.default = '0'; o.rmempty = false;
  o = section.option(form.Value, 'private_key', _('Private key'));
  concealed(o); o.rmempty = false; o.validate = keyValid;
  o = section.option(form.Value, '_public_key', _('Local public key'));
  o.readonly = true;
  o.load = async () => {
    const key = uci.get('network', name, 'private_key');
    return key ? L.resolveDefault(publicKey(key).then(pair => pair.pub || ''), '') : '';
  };
  o.write = o.remove = () => {};
  const pub = o;
  section.getOption('private_key').onchange = async function(id, value) {
    if (value && keyValid(id, value) === true) {
      const pair = await publicKey(value);
      pub.getUIElement(id)?.setValue(pair.pub || '');
    }
  };
  o = section.option(form.DynamicList, 'addresses', _('Tunnel IPv4 addresses'));
  o.datatype = 'ip4addr'; o.rmempty = false; o.placeholder = '10.77.0.2/32';
  o = section.option(form.Value, 'listen_port', _('Listen port'));
  o.datatype = 'port'; o.placeholder = _('Automatic');
  o = section.option(form.SectionValue, '_peers', form.TypedSection, 'wireguard_' + name, _('Peers'));
  const peers = o.subsection;
  peers.anonymous = true; peers.addremove = true; peers.addbtntitle = _('Add peer');
  peers.handleAdd = async function() {
    await agentState.assertManual();
    const id = uci.add('network', 'wireguard_' + name);
    for (const [key, value] of Object.entries(peerDefaults)) uci.set('network', id, key, value);
    return map.save(null, true);
  };
  const renderPeers = peers.renderContents;
  peers.renderContents = function(ids, nodes) {
    const node = renderPeers.call(this, ids, nodes);
    if (ids.length <= 1)
      node.querySelectorAll('.cbi-section-remove').forEach(buttons => buttons.remove());
    return node;
  };
  peers.handleRemove = async function(id) {
    await agentState.assertManual();
    if (this.cfgsections().length <= 1) throw new Error(_('Keep at least one peer.'));
    uci.remove('network', id);
    return map.save(null, true);
  };
  o = peers.option(form.Value, 'description', _('Name'));
  o = peers.option(form.Value, 'public_key', _('Peer public key'));
  o.rmempty = false; o.validate = keyValid;
  o = peers.option(form.Value, 'preshared_key', _('Preshared key'));
  concealed(o); o.validate = keyValid;
  o = peers.option(form.Value, 'endpoint_host', _('Endpoint host'));
  o.datatype = 'host';
  o = peers.option(form.Value, 'endpoint_port', _('Endpoint port'));
  o.datatype = 'port';
  o = peers.option(form.DynamicList, 'allowed_ips', _('Allowed IPv4 addresses'));
  o.datatype = 'ip4addr'; o.rmempty = false; o.placeholder = '10.77.0.1/32';
  o.validate = function(id, value) {
    if (list(value).some(defaultRoute))
      return _('Keep the management default route outside WireGuard.');
    return true;
  };
  if (name === map._tunnelNames[map._tunnelNames.length - 1]) {
    o = section.option(form.DummyValue, '_apply', ' ');
    o.renderWidget = () => E('button', {
      class: 'btn cbi-button cbi-button-apply important', disabled: map.readonly || null,
      click: ui.createHandlerFn(null, async () => {
        await agentState.assertManual();
        await map.save(() => { provision(map._tunnelNames); });
        ui.changes.apply(true);
      })
    }, _('Save & Apply'));
  }
}

async function render() {
  const names = uci.sections('network', 'interface').filter(s => s.proto === 'wireguard').map(s => s['.name']);
  if (!names.length) {
    let i = 0;
    while (uci.get('network', 'wg' + i)) i++;
    names.push('wg' + i);
  }
  const map = new form.Map('network');
  map._tunnelNames = names;
  map.chain('firewall');
  map.readonly = !L.hasViewPermission();
  for (const name of names) fields(map, name);
  // Keep map identity distinct from the management-interface form.
  const original = map.renderContents;
  map.renderContents = function(...args) {
    return Promise.resolve(original.apply(this, args)).then(node => {
      node.id = 'cbi-airrelay-wireguard';
      node.classList.add('ar-wg-config');
      return node;
    });
  };
  return map.render().then(node => E('section', { class: 'ar-wg-editor' }, [
    E('h2', {}, _('WireGuard')),
    node
  ]));
}

return baseclass.extend({ keyValid, provision, render });
