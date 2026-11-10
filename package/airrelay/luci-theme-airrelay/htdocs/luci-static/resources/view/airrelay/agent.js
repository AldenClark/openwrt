'use strict';
'require view';

return view.extend({
  render() {
    return E('div', { class: 'ar-agent-page' }, [
      E('div', { class: 'ar-page-heading' }, [
        E('div', {}, [
          E('div', { class: 'ar-eyebrow' }, 'CONTROL PLANE'),
          E('h2', {}, 'AirRoute Agent'),
          E('p', {}, '云端注册、配置下发与运行状态将在此集中展示')
        ])
      ]),
      E('section', { class: 'ar-panel ar-agent-hero' }, [
        E('div', { class: 'ar-agent-symbol', 'aria-hidden': 'true' }, '✧'),
        E('span', { class: 'ar-pill' }, '尚未集成'),
        E('h3', { style: 'margin-top:16px' }, '一个节点，一个轻量 Agent'),
        E('p', {}, '正式版 Agent 将使用 Rust 实现。它负责节点注册、接收云端指令，并通过内核接口配置 WireGuard 和网络转发；实际数据面不经过 Agent。'),
        E('ul', { class: 'ar-list' }, [
          E('li', {}, '安全认领设备并连接控制中心'),
          E('li', {}, '同步 WireGuard Peer、路由与网络策略'),
          E('li', {}, '报告心跳、链路质量、流量和系统资源'),
          E('li', {}, '原子应用配置并在异常时回滚')
        ])
      ]),
      E('div', { class: 'ar-notice' },
        '本页面是预留入口，不代表 Agent 已安装、已连接云端或正在运行。当前设备仍可独立使用内核 WireGuard。')
    ]);
  },

  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
