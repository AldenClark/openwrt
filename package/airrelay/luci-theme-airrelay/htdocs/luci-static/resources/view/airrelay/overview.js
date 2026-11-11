'use strict';
'require view';
'require rpc';
'require poll';
'require fs';
'require airrelay.wireguard as wireguard';
'require airrelay.traffic as traffic';

const callBoard = rpc.declare({ object: 'system', method: 'board', expect: { '': {} } });
const callInfo = rpc.declare({ object: 'system', method: 'info', expect: { '': {} } });
const callInterfaces = rpc.declare({ object: 'network.interface', method: 'dump', expect: { interface: [] } });
const callPort = rpc.declare({ object: 'network.device', method: 'status', params: ['name'], expect: { '': {} } });
const ports = ['lan1', 'lan2', 'lan3', 'lan4'];

function safe(promise, fallback) {
  return L.resolveDefault(promise, fallback);
}

function snapshot() {
  return Promise.all([
    safe(callInfo(), {}),
    safe(callInterfaces(), []),
    safe(callPort('br-lan'), {}),
    safe(fs.read('/tmp/airrelay-traffic/history'), ''),
    ...ports.map(name => safe(callPort(name), {}))
  ]).then(async ([info, interfaces, bridge, history, ...states]) =>
    [info, interfaces, bridge, history, await wireguard.snapshot(interfaces), ...states]);
}

function humanUptime(value) {
  if (typeof value !== 'number' || value < 0)
    return '—';

  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);

  return days ? _('%d d %d h').format(days, hours) : _('%d h %d m').format(hours, minutes);
}

function trafficCard(label, key) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 320 85');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ar-traffic-chart');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('class', `ar-traffic-line ar-traffic-line-${key}`);
  path.setAttribute('data-ar-graph', key);
  svg.appendChild(path);
  return E('section', { class: 'ar-panel ar-traffic-panel' }, [
    E('h3', {}, label),
    E('div', { class: 'ar-traffic-value', 'data-ar': `${key}-rate` }, '—'),
    E('div', { class: 'ar-traffic-total' }, [ _('Total traffic'), ': ', E('strong', { 'data-ar': `${key}-total` }, '—') ]),
    svg,
    E('div', { class: 'ar-chart-range' }, [ E('span', {}, _('1 hour ago')), E('span', {}, _('Now')) ])
  ]);
}

function metric(label, key) {
  return E('div', { class: 'ar-card' }, [
    E('div', { class: 'ar-card-label' }, label),
    E('div', { class: 'ar-card-value', 'data-ar': key }, '—')
  ]);
}

function infoLine(label, key) {
  return E('div', { class: 'ar-kv' }, [
    E('span', {}, label),
    E('strong', { 'data-ar': key }, '—')
  ]);
}

return view.extend({
  load() {
    return Promise.all([safe(callBoard(), {}), snapshot()]);
  },

  render([board, data]) {
    const page = E('div', { class: 'ar-dashboard' }, [
      E('div', { class: 'ar-page-heading' }, [
        E('div', {}, [
          E('h2', {}, _('Live status'))
        ]),
        E('div', { class: 'ar-freshness', 'data-ar': 'fresh' }, _('Loading status…'))
      ]),
      E('div', { class: 'ar-grid' }, [
        metric(_('Uptime'), 'uptime'),
        metric(_('System load'), 'load'),
        metric(_('Memory used'), 'memory')
      ]),
      wireguard.render(),
      E('div', { class: 'ar-traffic-grid' }, [
        trafficCard(_('Download'), 'rx'),
        trafficCard(_('Upload'), 'tx')
      ]),
      E('div', { class: 'ar-panel-grid' }, [
        E('section', { class: 'ar-panel' }, [
          E('h3', {}, _('Ethernet ports')),
          E('div', { class: 'ar-port-grid' }, ports.map(name =>
            E('div', { class: 'ar-port', 'data-ar-port': name }, [
              E('span', { class: 'ar-port-dot' }),
              E('strong', {}, name.toUpperCase()),
              E('small', {}, _('Checking…'))
            ])
          )),
          E('div', { class: 'ar-actions' }, [
            E('a', { class: 'ar-button', href: L.url('admin/airrelay/settings') }, _('Settings'))
          ])
        ]),
        E('section', { class: 'ar-panel' }, [
          E('h3', {}, _('Device information')),
          infoLine(_('Model'), 'model'),
          infoLine(_('Kernel'), 'kernel'),
          infoLine(_('Management IPv4'), 'ipaddr'),
          infoLine(_('Gateway'), 'gateway'),
          infoLine(_('Firmware'), 'release')
        ])
      ])
    ]);

    this._board = board || {};
    this._trafficSample = traffic.tracker();
    this.updateSnapshot(page, data);
    poll.add(() => snapshot().then(data => this.updateSnapshot(page, data)), 5);

    return page;
  },

  updateSnapshot(page, data) {
    if (!page.isConnected && this._initialized)
      return;

    const [info, interfaces, bridge, historyText, tunnels, ...portStates] = data;
    const all = Array.isArray(interfaces) ? interfaces : [];
    const lan = all.find(i => i.interface === 'lan') || {};
    const memory = info?.memory || {};
    const board = this._board || {};
    const release = board.release || {};
    const used = Number(memory.total) - Number(memory.available ?? memory.free);
    const percent = Number(memory.total) > 0 ? Math.round(used / memory.total * 100) : null;
    const oneMinuteLoad = Array.isArray(info?.load) ? (info.load[0] / 65535).toFixed(2) : '—';
    const firstV4 = Array.isArray(lan['ipv4-address']) ? lan['ipv4-address'][0] : null;
    const firstRoute = Array.isArray(lan.route) ? lan.route.find(r => r.target === '0.0.0.0' && r.nexthop) : null;

    const set = (key, value) => {
      const el = page.querySelector(`[data-ar="${key}"]`);
      if (el) el.textContent = value ?? '—';
      return el;
    };

    set('uptime', humanUptime(info?.uptime));
    set('load', oneMinuteLoad);
    set('memory', percent !== null ? `${Math.max(0, Math.min(100, percent))}%` : '—');
    set('model', board.model || '—');
    set('kernel', board.kernel || '—');
    set('ipaddr', firstV4?.address || _('Unavailable'));
    set('gateway', firstRoute?.nexthop || '—');
    set('release', release.description || [ release.distribution, release.version ].filter(Boolean).join(' ') || '—');
    set('fresh', _('Updated at %s').format(new Date().toLocaleTimeString()));

    const trafficNow = this._trafficSample('br-lan', bridge);
    const history = traffic.history(historyText, info?.uptime);
    const latest = history[history.length - 1];
    for (const side of ['rx', 'tx']) {
      const rate = trafficNow?.[`${side}Rate`] ??
        (latest && info.uptime - latest.time <= 30 ? latest[`${side}Rate`] : null);
      set(`${side}-rate`, rate == null ? '—' : `${traffic.bytes(rate)}/s`);
      set(`${side}-total`, trafficNow ? traffic.bytes(trafficNow[side]) : '—');
      const path = page.querySelector(`[data-ar-graph="${side}"]`);
      if (path) path.setAttribute('d', traffic.linePath(history, side, info?.uptime));
    }
    wireguard.update(page, tunnels);

    ports.forEach((name, index) => {
      const state = portStates[index] || {};
      const container = page.querySelector(`[data-ar-port="${name}"]`);
      if (!container) return;

      const up = Boolean(state.carrier);
      container.classList.toggle('is-up', up);
      const speed = Number(state.speed) > 0 ? _('%d Mb/s').format(state.speed) : _('Connected');
      container.querySelector('small').textContent = up ? speed : _('Disconnected');
    });
    this._initialized = true;
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
