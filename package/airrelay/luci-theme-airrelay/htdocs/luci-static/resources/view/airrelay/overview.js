'use strict';
'require view';
'require rpc';
'require poll';

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
    ...ports.map(name => safe(callPort(name), {}))
  ]);
}

function humanUptime(value) {
  if (typeof value !== 'number' || value < 0)
    return '—';

  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);

  return days ? `${days}天 ${hours}小时` : `${hours}小时 ${minutes}分`;
}

function metric(label, key, detail) {
  return E('div', { class: 'ar-card' }, [
    E('div', { class: 'ar-card-label' }, label),
    E('div', { class: 'ar-card-value', 'data-ar': key }, '—'),
    E('div', { class: 'ar-card-detail' }, detail)
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
          E('div', { class: 'ar-eyebrow' }, 'NODE OVERVIEW'),
          E('h2', {}, '节点实时状态'),
          E('p', {}, '轻量状态采集 · 每 5 秒更新 · 不启动额外常驻服务')
        ]),
        E('div', { class: 'ar-freshness', 'data-ar': 'fresh' }, '正在读取状态')
      ]),
      E('div', { class: 'ar-grid' }, [
        metric('运行时间', 'uptime', '设备本次启动时长'),
        metric('系统负载', 'load', '1 分钟平均负载'),
        metric('内存占用', 'memory', '按可用内存计算'),
        metric('WireGuard 接口', 'wireguard', '接口运行状态，不代表已握手')
      ]),
      E('div', { class: 'ar-panel-grid' }, [
        E('section', { class: 'ar-panel' }, [
          E('h3', {}, '以太网端口'),
          E('p', { class: 'ar-panel-subtitle' }, '四个铜口 · 物理链路状态'),
          E('div', { class: 'ar-port-grid' }, ports.map(name =>
            E('div', { class: 'ar-port', 'data-ar-port': name }, [
              E('span', { class: 'ar-port-dot' }),
              E('strong', {}, name.toUpperCase()),
              E('small', {}, '检测中')
            ])
          )),
          E('div', { class: 'ar-actions' }, [
            E('a', { class: 'ar-button', href: L.url('admin/airrelay/network') }, '网络设置')
          ])
        ]),
        E('section', { class: 'ar-panel' }, [
          E('h3', {}, '系统与上联'),
          E('p', { class: 'ar-panel-subtitle' }, '管理接口状态 · IPv4'),
          infoLine('设备型号', 'model'),
          infoLine('内核版本', 'kernel'),
          infoLine('上联 IPv4', 'ipaddr'),
          infoLine('上联网关', 'gateway'),
          infoLine('固件版本', 'release')
        ])
      ]),
      E('div', { class: 'ar-notice' }, [
        E('strong', {}, '关于 WireGuard：'),
        '这里展示内核接口是否启动；实际对端握手、传输计数和链路质量仍需通过 ',
        E('code', {}, 'wg show'),
        ' 核实。云端节点管理将在 Agent 接入后提供。'
      ])
    ]);

    this._board = board || {};
    this.updateSnapshot(page, data);
    poll.add(() => snapshot().then(data => this.updateSnapshot(page, data)), 5);

    return page;
  },

  updateSnapshot(page, data) {
    if (!page.isConnected && this._initialized)
      return;

    const [info, interfaces, ...portStates] = data;
    const all = Array.isArray(interfaces) ? interfaces : [];
    const lan = all.find(i => i.interface === 'lan') || {};
    const wg = all.filter(i => i.proto === 'wireguard');
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
    const wgStatus = wg.length === 0 ? '未配置' : wg.some(i => i.up) ? '已启动' : '未启动';
    const wgEl = set('wireguard', wgStatus);
    if (wgEl) {
      wgEl.classList.toggle('ar-value-up', wg.some(i => i.up));
      wgEl.classList.toggle('ar-value-down', wg.length > 0 && !wg.some(i => i.up));
    }

    set('model', board.model || '—');
    set('kernel', board.kernel || '—');
    set('ipaddr', firstV4?.address || '未获取');
    set('gateway', firstRoute?.nexthop || '—');
    set('release', release.version || release.description || '—');
    set('fresh', `已更新 ${new Date().toLocaleTimeString()}`);

    ports.forEach((name, index) => {
      const state = portStates[index] || {};
      const container = page.querySelector(`[data-ar-port="${name}"]`);
      if (!container) return;

      const up = Boolean(state.carrier);
      container.classList.toggle('is-up', up);
      const speed = Number(state.speed) > 0 ? `${state.speed} Mb/s` : '已连接';
      container.querySelector('small').textContent = up ? speed : '未连接';
    });
    this._initialized = true;
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
