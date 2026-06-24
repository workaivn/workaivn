import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageJsonScriptInstruction, applyScriptInstructionToPackage } from '../runAgentLoop.js';

test('parse add script', () => {
  const instr = parsePackageJsonScriptInstruction('Add script "temp:test": "echo ok"');
  assert.deepEqual(instr, { action: 'add', name: 'temp:test', value: 'echo ok' });
});

test('parse rename script', () => {
  const instr = parsePackageJsonScriptInstruction('Rename script temp:test to temp:test2');
  assert.deepEqual(instr, { action: 'rename', from: 'temp:test', to: 'temp:test2' });
});

test('parse remove script', () => {
  const instr = parsePackageJsonScriptInstruction('Remove script "temp:test"');
  assert.deepEqual(instr, { action: 'remove', name: 'temp:test' });
});

test('parse set script', () => {
  const instr = parsePackageJsonScriptInstruction('Set script temp:test to "echo hi"');
  assert.deepEqual(instr, { action: 'set', name: 'temp:test', value: 'echo hi' });
});

test('apply rename script', () => {
  const pkg = { name: 'app', scripts: { 'temp:test': 'echo ok' } };
  const instr = { action: 'rename', from: 'temp:test', to: 'temp:test2' };
  const { modified, pkg: out } = applyScriptInstructionToPackage(pkg, instr);
  assert.equal(modified, true);
  assert.equal(out.scripts['temp:test2'], 'echo ok');
  assert.equal(out.scripts['temp:test'], undefined);
});
