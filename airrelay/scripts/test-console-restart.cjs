#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync}=require('node:child_process');
const pkg=path.resolve(__dirname,'../../package/airrelay/luci-theme-airrelay');
const helper=path.join(pkg,'root/usr/libexec/airrelay-wg-restart');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'airrelay-restart-'));
const log=path.join(tmp,'calls');
try {
  fs.writeFileSync(path.join(tmp,'uci'), `#!/bin/sh
case "$3" in
  *.proto) printf '%s\\n' "$AR_TEST_PROTO" ;;
  *.disabled) printf '%s\\n' "$AR_TEST_DISABLED" ;;
esac
`,{mode:0o755});
  fs.writeFileSync(path.join(tmp,'ubus'), `#!/bin/sh
printf '%s\\n' "$*" >> "$AR_TEST_LOG"
case "$3" in
  down) exit "$AR_TEST_DOWN_CODE" ;;
  up) exit "$AR_TEST_UP_CODE" ;;
esac
`,{mode:0o755});
  function run(args,extra={}) {
    fs.writeFileSync(log,'');
    const result=spawnSync('sh',[helper,...args],{encoding:'utf8',env:{...process.env,
      PATH:tmp+':'+process.env.PATH,AR_TEST_LOG:log,AR_TEST_PROTO:'wireguard',AR_TEST_DISABLED:'0',AR_TEST_DOWN_CODE:'0',AR_TEST_UP_CODE:'0',...extra}});
    return {...result,calls:fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean)};
  }
  const ok=run(['wg']);
  assert.equal(ok.status,0);
  assert.deepEqual(ok.calls,['call network.interface.wg down','call network.interface.wg up']);
  for (const args of [[],['wg','lan'],['wg;reboot'],['wg\nlan'],['']]) {
    const result=run(args); assert.notEqual(result.status,0); assert.deepEqual(result.calls,[]);
  }
  for(const conditions of [{AR_TEST_PROTO:'dhcp'},{AR_TEST_DISABLED:'1'}]) {
    const result=run(['wg'],conditions); assert.notEqual(result.status,0); assert.deepEqual(result.calls,[]);
  }
  let result=run(['wg'],{AR_TEST_DOWN_CODE:'1'});
  assert.notEqual(result.status,0); assert.deepEqual(result.calls,['call network.interface.wg down']);
  result=run(['wg'],{AR_TEST_UP_CODE:'1'}); assert.notEqual(result.status,0);
  assert.deepEqual(result.calls,['call network.interface.wg down','call network.interface.wg up']);
  const acl=JSON.parse(fs.readFileSync(path.join(pkg,'root/usr/share/rpcd/acl.d/luci-theme-airrelay.json'),'utf8'));
  assert.deepEqual(acl['luci-airrelay-wireguard-restart'].write.file,{'/usr/libexec/airrelay-wg-restart *':['exec']});
  assert.equal(acl['luci-theme-airrelay'].write.ubus?.file,undefined);
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
async function frontend() {
  const calls=[],notifications=[],samples=[];
  let resolveCommand;
  const source=fs.readFileSync(path.join(pkg,'htdocs/luci-static/resources/airrelay/wireguard.js'),'utf8');
  const mod=new Function('baseclass','rpc','fs','ui','traffic','E','_',source)(
    {extend:x=>x},{declare:()=>()=>Promise.resolve({})},
    {exec:(program,args)=>{calls.push([program,args]);return new Promise(resolve=>{resolveCommand=resolve;});}},
    {addNotification:(_title,content)=>notifications.push(content)}, {}, (tag,attrs,child)=>({tag,attrs,child}),x=>x);
  mod._interfaces=[{link:{interface:'wg',proto:'wireguard'},canRestart:true}];
  mod._restarting=new Set(); mod._traffic=(name,state)=>samples.push([name,state]);
  const first=mod.restart('wg');
  await mod.restart('wg'); assert.equal(calls.length,1);
  assert.deepEqual(calls[0],['/usr/libexec/airrelay-wg-restart',['wg']]);
  assert.equal(mod._restarting.has('wg'),true);
  resolveCommand({code:0}); await first;
  assert.equal(mod._restarting.size,0); assert.deepEqual(samples,[['wg',{}]]);
  const failed=mod.restart('wg'); resolveCommand({code:1,stderr:'restart rejected'}); await failed;
  assert.equal(notifications.length,1); assert.equal(mod._restarting.size,0);
  const count=calls.length;
  await mod.restart('lan'); assert.equal(calls.length,count);
  mod._interfaces[0].canRestart=false;
  await mod.restart('wg'); assert.equal(calls.length,count);
  console.log('AirRelay restart: single-interface down/up, guards, failure, permissions and duplicate clicks OK');
}
frontend().catch(e=>{console.error(e);process.exitCode=1;});
