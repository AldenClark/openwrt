#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const resources = path.resolve(__dirname, '../../package/airrelay/luci-theme-airrelay/htdocs/luci-static/resources/airrelay');
let serviceState = {}, serviceError = null;
const dependencies = {
  baseclass: { extend: value => value }, _: value => value, form: {}, ui: {},
  L: { hasViewPermission: () => true }, E: (tag,attrs,children) => ({tag,attrs,children}),
  rpc: { declare: spec => () => spec.object === 'rc'
    ? (serviceError ? Promise.reject(serviceError) : Promise.resolve(serviceState))
    : Promise.resolve({}) }
};
function module(name) {
  const names = Object.keys(dependencies);
  return new Function(...names, fs.readFileSync(path.join(resources, name + '.js'), 'utf8'))(...names.map(n=>dependencies[n]));
}
const agent = dependencies.agentState = module('agent-state');
let db, serial, changes;
const uci = dependencies.uci = {
  sections(config, type) { return Object.entries(db[config]).filter(([,v])=>v['.type']===type).map(([id,v])=>({...v,'.name':id})); },
  get(config,id,key) { return key == null ? db[config][id] : db[config][id]?.[key]; },
  set(config,id,key,value) { changes++; db[config][id][key]=value; },
  add(config,type,id='test'+(++serial)) { changes++; assert.equal(db[config][id], undefined); db[config][id]={'.type':type}; return id; },
  remove(config,id) { changes++; delete db[config][id]; }
};
const wg = module('wg-config');
function reset() {
  serial=0; changes=0;
  db={network:{wg0:{'.type':'interface',proto:'wireguard',listen_port:'51820'}},firewall:{up:{'.type':'zone',name:'uplink',network:['lan','extra'],input:'REJECT'},custom:{'.type':'rule',name:'User rule',dest_port:'22'}}};
}
async function run() {
  assert.deepEqual(agent.classify({}), {installed:false,enabled:false,managed:false});
  assert.equal(agent.classify({'airroute-agent':{enabled:true,running:false}}).managed,true);
  assert.equal(agent.classify({'airroute-agent':{enabled:false,running:true}}).managed,true);
  assert.equal(agent.classify({'airroute-agent':{enabled:false,running:false}}).managed,false);
  assert.throws(()=>agent.classify(null));
  serviceState={'airroute-agent':{enabled:true}};
  await assert.rejects(agent.assertManual(),/managing/);
  serviceState={}; await agent.assertManual();
  serviceError=new Error('RPC unavailable');
  await assert.rejects(agent.assertManual(),/RPC unavailable/);
  serviceError=null;
  assert.equal(wg.keyValid('',Buffer.alloc(32,1).toString('base64')),true);
  for (const value of ['bad','A'.repeat(43)+'=', 'x'.repeat(43)+'='])
    assert.notEqual(wg.keyValid('',value),true);
  reset(); const custom=structuredClone(db.firewall.custom);
  wg.provision(['wg0']);
  assert.deepEqual(db.firewall.up.network,['lan','extra']);
  assert.equal(db.firewall.up.masq,'1');
  assert.deepEqual(db.firewall.custom,custom);
  const tunnel=uci.sections('firewall','zone').find(s=>s.name==='airrelay_wg');
  assert.deepEqual(tunnel.network,['wg0']);
  assert.equal(tunnel.input,'REJECT');
  assert.ok(uci.sections('firewall','forwarding').some(s=>s.src==='airrelay_wg'&&s.dest==='uplink'));
  assert.equal(db.firewall.airrelay_wg_wg0.dest_port,'51820');
  assert.equal(db.firewall.airrelay_wg_wg0.proto,'udp');
  const count=Object.keys(db.firewall).length;
  wg.provision(['wg0']); assert.equal(Object.keys(db.firewall).length,count);
  db.network.wg0.listen_port='51821'; wg.provision(['wg0']);
  assert.equal(db.firewall.airrelay_wg_wg0.dest_port,'51821');
  db.network.wg0.disabled='1'; wg.provision(['wg0']);
  assert.equal(db.firewall.airrelay_wg_wg0.enabled,'0');
  delete db.network.wg0.listen_port; wg.provision(['wg0']);
  assert.equal(db.firewall.airrelay_wg_wg0,undefined);
  reset(); db.firewall.vpn={'.type':'zone',name:'vpn',network:['wg0','other'],input:'ACCEPT'};
  db.firewall.up.input='ACCEPT'; const before=structuredClone(db.firewall);
  wg.provision(['wg0']); assert.deepEqual(db.firewall,before);
  reset(); delete db.firewall.up;
  assert.throws(()=>wg.provision(['wg0']),/No firewall zone/); assert.equal(changes,0);
  reset(); db.firewall.airrelay_wg_wg0={'.type':'rule',name:'User-owned rule'};
  assert.throws(()=>wg.provision(['wg0']),/already in use/); assert.equal(changes,0);
  for (const ip of ['0.0.0.0/0','10.1.2.3/0','0.0.0.0/0.0.0.0']) {
    reset(); db.network.peer={'.type':'wireguard_wg0',allowed_ips:[ip],route_allowed_ips:'1'};
    assert.throws(()=>wg.provision(['wg0']),/default route/); assert.equal(changes,0);
  }
  reset();
  db.network.peer={'.type':'wireguard_wg0',allowed_ips:['10.77.0.1/32'],route_allowed_ips:'0',persistent_keepalive:'0'};
  wg.provision(['wg0']);
  assert.equal(db.network.peer.route_allowed_ips,'1');
  assert.equal(db.network.peer.persistent_keepalive,'25');

  // Exercise peer UI guards with synthetic native-form objects; no device UCI.
  const maps=[];
  let removedButtons=0;
  class Section {
    constructor(map,type,args) { this.map=map; this.options={}; this.sectiontype=type==='named'?args[1]:args[0]; }
    option(type,name,...args) {
      const o={ renderWidget() {} };
      if(type==='section') o.subsection=new Section(this.map,'typed',args.slice(1));
      this.options[name]=o; return o;
    }
    getOption(name) { return this.options[name]; }
    cfgsections() { return uci.sections('network',this.sectiontype).map(s=>s['.name']); }
    renderContents() { return {querySelectorAll:()=>[{remove(){removedButtons++;}}]}; }
  }
  Object.assign(dependencies.form,{NamedSection:'named',TypedSection:'typed',SectionValue:'section',
    Map: class {
      constructor(){this.sections=[];this.saves=0;maps.push(this);}
      chain(){}
      section(type,...args){const s=new Section(this,type,args);this.sections.push(s);return s;}
      save(){this.saves++;return Promise.resolve();}
      renderContents(){return {classList:{add(){}},id:''};}
      render(){return this.renderContents();}
    }});
  reset();
  db.network.lan={'.type':'interface',proto:'dhcp'};
  db.network.peer={'.type':'wireguard_wg0',allowed_ips:['10.77.0.1/32']};
  await wg.render();
  const map=maps.at(-1), tunnelSection=map.sections[0], peers=tunnelSection.options._peers.subsection;
  assert.equal(tunnelSection.options._generate,undefined);
  assert.equal(peers.options.route_allowed_ips,undefined);
  assert.equal(peers.options.persistent_keepalive,undefined);
  peers.renderContents(['peer'],[]); assert.equal(removedButtons,1);
  peers.renderContents(['peer','peer2'],[]); assert.equal(removedButtons,1);
  await assert.rejects(peers.handleRemove('peer'),/at least one/);
  assert.equal(changes,0);
  db.network.peer2={'.type':'wireguard_wg0'};
  await peers.handleRemove('peer');
  assert.equal(db.network.peer,undefined); assert.ok(db.network.peer2);
  await peers.handleAdd();
  const added=uci.sections('network','wireguard_wg0').find(p=>p['.name']!=='peer2');
  assert.equal(added.route_allowed_ips,'1');
  assert.equal(added.persistent_keepalive,'25');
  assert.deepEqual(db.network.lan,{'.type':'interface',proto:'dhcp'});
  serviceState={'airroute-agent':{enabled:true}};
  const protectedState=structuredClone(db);
  await assert.rejects(peers.handleAdd(),/managing/);
  assert.deepEqual(db,protectedState);
  serviceState={};
  reset(); db.network={};
  await wg.render();
  const emptyTunnel=maps.at(-1).sections[0];
  assert.equal(emptyTunnel.addremove,true);
  await emptyTunnel.handleAdd();
  assert.equal(db.network.wg0.proto,'wireguard');
  assert.equal(db.network.wg0.tunlink,'lan');
  assert.equal(db.network.wg0.listen_port,'51820');
  assert.equal(db.network.wg0.private_key,undefined);

  console.log('AirRelay WireGuard: Agent ownership, keys, route protection and firewall preservation OK');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
