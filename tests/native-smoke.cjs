const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const exe = resolve(process.argv[2]);
const proc = spawn(exe, [], { windowsHide:true,stdio:['pipe','pipe','pipe'] });
const input = Buffer.from(JSON.stringify({action:'ping'}));const prefix=Buffer.alloc(4);prefix.writeUInt32LE(input.length);
proc.stdin.end(Buffer.concat([prefix,input]));
let buffer=Buffer.alloc(0), errors='';
proc.stdout.on('data',d=>buffer=Buffer.concat([buffer,d]));proc.stderr.on('data',d=>errors+=d.toString());
proc.on('error',err=>{console.error(err);process.exitCode=1});
proc.on('close',code=>{
  assert.equal(code,0,errors);
  assert.ok(buffer.length>=4,errors);
  assert.equal(buffer.readUInt32LE(0),buffer.length-4);
  const obj=JSON.parse(buffer.subarray(4).toString());
  assert.equal(obj.success,true);assert.equal(obj.ready,true);
  console.log('PASS: bundled Windows OnCoBridge.exe native messaging handshake');
});