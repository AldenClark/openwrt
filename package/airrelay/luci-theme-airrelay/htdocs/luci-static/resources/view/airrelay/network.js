'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require poll';
'require airrelay.traffic as traffic';

const callInterfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { interface: [] } });
const callDevice = rpc.declare({ object: 'network.device', method: 'status', params: [ 'name' ], expect: { '': {} } });

async function wireguardSnapshot() {
  const all = await L.resolveDefault(callInterfaces(), []);
  const links = (Array.isArray(all) ? all : []).filter(i => i.proto === 'wireguard');
  const states = await Promise.all(links.map(i => L.resolveDefault(callDevice(i.l3_device || i.device || i.interface), {})));
  return links.map((link, index) => ({ link, state: states[index] }));
}

function field(label, content) {
  return E('div', { class: 'ar-wg-detail' }, [ E('small', {}, label), E('strong', {}, content) ]);
}

return view.extend({
  load() {
    return Promise.all([ uci.load('network'), wireguardSnapshot() ]);
  },

  render([_config, wireguard]) {
    const map = new form.Map('network', _('Management connection'),
      _('Configure only the device management address. The four Ethernet ports remain bridged; this node does not serve DHCP.'));
    map.readonly = !L.hasViewPermission();

    const section = map.section(form.NamedSection, 'lan', 'interface', _('br-lan · management'));
    section.addremove = false;
    section.anonymous = true;

    let option = section.option(form.DummyValue, '_device', _('Device'));
    option.cfgvalue = () => 'br-lan (LAN1–LAN4)';

    option = section.option(form.ListValue, 'proto', _('IPv4 address mode'));
    option.value('dhcp', _('Automatic (DHCP client)'));
    option.value('static', _('Static IPv4'));
    option.rmempty = false;
    option.default = 'dhcp';

    option = section.option(form.Value, 'ipaddr', _('IPv4 address'));
    option.datatype = 'ip4addr';
    option.rmempty = false;
    option.placeholder = '192.168.1.20';
    option.depends('proto', 'static');

    option = section.option(form.Value, 'netmask', _('Subnet mask'));
    option.datatype = 'ip4addr';
    option.default = '255.255.255.0';
    option.rmempty = false;
    option.depends('proto', 'static');

    option = section.option(form.Value, 'gateway', _('Default gateway'));
    option.datatype = 'ip4addr';
    option.placeholder = '192.168.1.1';
    option.rmempty = true;
    option.depends('proto', 'static');

    option = section.option(form.DynamicList, 'dns', _('DNS servers'));
    option.datatype = 'ip4addr';
    option.rmempty = true;
    option.depends('proto', 'static');

    return map.render().then(node => {
      const page = E('div', { class: 'ar-network-page' }, [
      E('div', { class: 'ar-page-heading' }, [
        E('div', {}, [
          E('div', { class: 'ar-eyebrow' }, _('UPLINK CONFIGURATION')),
          E('h2', {}, _('Network settings')),
          E('p', {}, _('Management IP and read-only WireGuard status'))
        ])
      ]),
      E('div', { class: 'ar-notice' }, [
        E('strong', {}, _('Connection safety: ')),
        _('Changing the management IP may interrupt this browser session. Confirm Save & Apply or allow automatic rollback.')
      ]),
      node,
      E('section', { class: 'ar-panel ar-wg-panel' }, [
        E('div', { class: 'ar-wg-head' }, [
          E('div', {}, [
            E('h3', {}, _('WireGuard tunnels')),
            E('p', { class: 'ar-panel-subtitle' }, _('Live interface status and kernel traffic counters. Settings are managed by AirRoute Agent.'))
          ]),
          E('span', { class: 'ar-freshness', 'data-wg-fresh': 'true' }, _('Loading status…'))
        ]),
        E('div', { 'data-wg-list': 'true' })
      ])
      ]);

      this._wgTraffic = traffic.tracker();
      this.updateWireguard(page, wireguard);
      poll.add(() => wireguardSnapshot().then(state => this.updateWireguard(page, state)), 5);
      return page;
    });
  },

  updateWireguard(page, interfaces) {
    if (!page.isConnected && this._wgInitialized) return;
    const root = page.querySelector('[data-wg-list]');
    if (!root) return;

    root.replaceChildren(...(interfaces.length ? interfaces.map(({ link, state }) => {
      const active = !!link.up;
      const sample = this._wgTraffic(link.interface, state);
      const addresses = (link['ipv4-address'] || []).map(x => `${x.address}/${x.mask}`).join(', ');
      return E('div', { class: 'ar-wg-item' }, [
        E('div', { class: 'ar-wg-name' }, [
          E('strong', {}, link.interface),
          E('span', { class: `ar-pill${active ? ' is-up' : ''}` }, active ? _('Interface up') : _('Interface down'))
        ]),
        E('div', { class: 'ar-wg-details' }, [
          field(_('IPv4 address'), addresses || '—'),
          field(_('Download'), sample ? `${traffic.bytes(sample.rx)} · ${sample.rxRate == null ? '—' : `${traffic.bytes(sample.rxRate)}/s`}` : '—'),
          field(_('Upload'), sample ? `${traffic.bytes(sample.tx)} · ${sample.txRate == null ? '—' : `${traffic.bytes(sample.txRate)}/s`}` : '—')
        ])
      ]);
    }) : [ E('p', { class: 'ar-muted' }, _('No WireGuard interface is configured.')) ]));

    const fresh = page.querySelector('[data-wg-fresh]');
    if (fresh) fresh.textContent = _('Updated at %s').format(new Date().toLocaleTimeString());
    this._wgInitialized = true;
  }
});
