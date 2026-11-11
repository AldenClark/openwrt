'use strict';
'require baseclass';
'require rpc';
'require fs';
'require ui';
'require airrelay.traffic as traffic';

const restartPath = '/usr/libexec/airrelay-wg-restart';
const canExecute = rpc.declare({ object: 'session', method: 'access', params: [ 'scope', 'object', 'function' ], expect: { access: false } });
const callDevice = rpc.declare({ object: 'network.device', method: 'status', params: [ 'name' ], expect: { '': {} } });

async function snapshot(all) {
  const links = (Array.isArray(all) ? all : []).filter(i => i.proto === 'wireguard');
  const states = await Promise.all(links.map(async link => ({
    link,
    state: await L.resolveDefault(callDevice(link.l3_device || link.device || link.interface), {}),
    canRestart: await L.resolveDefault(canExecute('file', restartPath + ' ' + link.interface, 'exec'), false)
  })));
  return states;
}

function field(label, content) {
  return E('div', { class: 'ar-wg-detail' }, [ E('small', {}, label), E('strong', {}, content) ]);
}

return baseclass.extend({
  snapshot,

  async restart(name) {
    if (!this._interfaces?.some(({ link, canRestart }) => link.interface === name && link.proto === 'wireguard' && canRestart))
      return;
    if (this._restarting.has(name)) return;
    this._restarting.add(name);
    try {
      const result = await fs.exec(restartPath, [ name ]);
      if (result.code !== 0) throw new Error(result.stderr || _('Tunnel restart failed.'));
      this._traffic(name, {});
    }
    catch (err) {
      ui.addNotification(null, E('p', { class: 'alert-message danger' }, err.message || _('Tunnel restart failed.')));
    }
    finally {
      this._restarting.delete(name);
    }
  },

  render() {
    this._traffic = traffic.tracker();
    this._restarting ??= new Set();
    this._wgInitialized = false;
    return E('section', { class: 'ar-panel ar-wg-panel' }, [
      E('div', { class: 'ar-wg-head' }, [
        E('h3', {}, _('WireGuard tunnels'))
      ]),
      E('div', { 'data-wg-list': 'true' })
    ]);
  },

  update(page, interfaces) {
    if (!page.isConnected && this._wgInitialized) return;
    this._interfaces = interfaces;
    const root = page.querySelector('[data-wg-list]');
    if (!root) return;

    root.replaceChildren(...(interfaces.length ? interfaces.map(({ link, state, canRestart }) => {
      const active = !!link.up;
      const sample = this._traffic(link.interface, state);
      const addresses = (link['ipv4-address'] || []).map(x => `${x.address}/${x.mask}`).join(', ');
      return E('div', { class: 'ar-wg-item' }, [
        E('div', { class: 'ar-wg-name' }, [
          E('strong', {}, link.interface),
          E('span', { class: `ar-pill${active ? ' is-up' : ''}` }, active ? _('Interface up') : _('Interface down')),
          E('button', {
            class: 'btn ar-wg-restart',
            disabled: !canRestart || this._restarting.has(link.interface) ? true : null,
            click: ui.createHandlerFn(this, 'restart', link.interface)
          }, this._restarting.has(link.interface) ? _('Restarting…') : _('Restart tunnel'))
        ]),
        E('div', { class: 'ar-wg-details' }, [
          field(_('IPv4 address'), addresses || '—'),
          field(_('Download'), sample ? `${traffic.bytes(sample.rx)} · ${sample.rxRate == null ? '—' : `${traffic.bytes(sample.rxRate)}/s`}` : '—'),
          field(_('Upload'), sample ? `${traffic.bytes(sample.tx)} · ${sample.txRate == null ? '—' : `${traffic.bytes(sample.txRate)}/s`}` : '—')
        ])
      ]);
    }) : [ E('p', { class: 'ar-muted' }, _('No WireGuard interface is configured.')) ]));

    this._wgInitialized = true;
  }
});
