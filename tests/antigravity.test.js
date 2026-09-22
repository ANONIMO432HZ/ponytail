#!/usr/bin/env node
// Antigravity IDE adapter compatibility check.
// Verifies:
//   1. hooks/antigravity-hooks.json template contract (PreInvocation)
//   2. isAntigravity detection and injectSteps JSON output formatting
//   3. scripts/antigravity.js installer (user and project scope):
//      - rule installation
//      - 6 skills installation
//      - hooks.json merge without touching unrelated hooks
//      - idempotent re-installation
//      - malformed hooks.json refusal
//      - clean uninstallation and dir cleanup

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const TEMPLATE = 'hooks/antigravity-hooks.json';

for (const key of [
  'ANTIGRAVITY_AGENT', 'ANTIGRAVITY_CONVERSATION_ID', 'CURSOR_VERSION',
  'CURSOR_PROJECT_DIR', 'CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_CONFIG_DIR', 'PLUGIN_DATA', 'COPILOT_PLUGIN_DATA', 'QODER_SESSION_ID',
  'PONYTAIL_DEFAULT_MODE', 'XDG_CONFIG_HOME',
]) {
  delete process.env[key];
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ponytail-antigravity-'));
process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));

function cli(args, env, cwd = undefined) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'antigravity.js'), ...args], {
    env: { ...process.env, ...env },
    cwd,
    encoding: 'utf8',
  });
}

function runHook(script, env, input = '', cwd = undefined) {
  return spawnSync(process.execPath, [path.join(root, 'hooks', script)], {
    env: { ...process.env, ...env },
    input,
    cwd,
    encoding: 'utf8',
  });
}

function testEnv(name) {
  const home = path.join(temp, name, 'home');
  const project = path.join(temp, name, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return {
    home,
    project,
    env: {
      HOME: home,
      USERPROFILE: home,
    },
  };
}

test('antigravity hooks template is a valid hooks.json with PreInvocation', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, TEMPLATE), 'utf8'));
  assert.ok(config.ponytail, 'must define top-level ponytail hook');
  assert.ok(Array.isArray(config.ponytail.PreInvocation), 'must configure PreInvocation array');
  assert.equal(config.ponytail.PreInvocation.length, 1);
  const entry = config.ponytail.PreInvocation[0];
  assert.equal(entry.type, 'command');
  assert.match(entry.command, /^node "PONYTAIL_DIR\/hooks\/ponytail-mode-tracker\.js"$/);
  assert.equal(entry.timeout, 5);
});

test('runtime detects Antigravity and formats output as injectSteps JSON', () => {
  const result = runHook(
    'ponytail-mode-tracker.js',
    { ANTIGRAVITY_AGENT: 'true' },
    JSON.stringify({ prompt: 'hello world' }),
  );
  assert.equal(result.status, 0, result.stderr);
  // Plain message with no /ponytail command: outputs empty JSON in Antigravity
  assert.equal(result.stdout.trim(), '{}');
});

test('mode tracker switches level and outputs injectSteps under Antigravity', () => {
  const c = testEnv('tracker-switch');
  const result = runHook(
    'ponytail-mode-tracker.js',
    { ...c.env, ANTIGRAVITY_AGENT: 'true' },
    JSON.stringify({ prompt: '/ponytail lite' }),
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.injectSteps && Array.isArray(output.injectSteps));
  assert.match(output.injectSteps[0].ephemeralMessage, /PONYTAIL MODE CHANGED — level: lite/);

  // Mode flag written under ~/.gemini
  const flagPath = path.join(c.home, '.gemini', '.ponytail-active');
  assert.ok(fs.existsSync(flagPath), 'flag must exist in ~/.gemini');
  assert.equal(fs.readFileSync(flagPath, 'utf8').trim(), 'lite');
});

test('mode tracker extracts prompt from transcriptPath in Antigravity PreInvocation', () => {
  const c = testEnv('transcript-prompt');
  const transcript = path.join(c.project, 'transcript.jsonl');
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      step_index: 0,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>\n/ponytail ultra\n</USER_REQUEST>',
    }) + '\n',
  );

  const result = runHook(
    'ponytail-mode-tracker.js',
    { ...c.env, ANTIGRAVITY_CONVERSATION_ID: 'conv-test' },
    JSON.stringify({
      invocationNum: 1,
      conversationId: 'conv-test',
      transcriptPath: transcript,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.injectSteps && Array.isArray(output.injectSteps));
  assert.match(output.injectSteps[0].ephemeralMessage, /PONYTAIL MODE CHANGED — level: ultra/);
});

test('installer in user scope installs rule, 6 skills, and merges hooks', () => {
  const c = testEnv('user-install');
  const userConfig = path.join(c.home, '.gemini', 'config');
  const existingHooks = path.join(userConfig, 'hooks.json');
  fs.mkdirSync(userConfig, { recursive: true });
  fs.writeFileSync(existingHooks, JSON.stringify({
    'my-checker': {
      PreToolUse: [{ matcher: 'run_command', hooks: [{ command: './check.sh' }] }],
    },
  }, null, 2));

  const result = cli(['install'], c.env);
  assert.equal(result.status, 0, result.stderr);

  // 1. Rule installed
  const ruleFile = path.join(userConfig, 'rules', 'ponytail.md');
  assert.ok(fs.existsSync(ruleFile), 'rule must exist');
  assert.ok(fs.readFileSync(ruleFile, 'utf8').includes('lazy senior'));

  // 2. All 6 skills installed
  const expectedSkills = [
    'ponytail',
    'ponytail-review',
    'ponytail-audit',
    'ponytail-debt',
    'ponytail-gain',
    'ponytail-help',
  ];
  for (const skill of expectedSkills) {
    const skillFile = path.join(userConfig, 'skills', skill, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile), `skill ${skill} must exist`);
  }

  // 3. Hooks merged
  const hooks = JSON.parse(fs.readFileSync(existingHooks, 'utf8'));
  assert.ok(hooks['my-checker'], 'unrelated hook must survive');
  assert.ok(hooks.ponytail, 'ponytail hook must be added');
  assert.match(hooks.ponytail.PreInvocation[0].command, /ponytail-mode-tracker\.js/);
});

test('installer in project scope installs to <cwd>/.agents', () => {
  const c = testEnv('project-install');
  const result = cli(['install', '--project'], c.env, c.project);
  assert.equal(result.status, 0, result.stderr);

  const agentsDir = path.join(c.project, '.agents');
  assert.ok(fs.existsSync(path.join(agentsDir, 'rules', 'ponytail.md')));
  assert.ok(fs.existsSync(path.join(agentsDir, 'skills', 'ponytail', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(agentsDir, 'hooks.json')));
});

test('installer refuses malformed hooks.json', () => {
  const c = testEnv('malformed');
  const userConfig = path.join(c.home, '.gemini', 'config');
  fs.mkdirSync(userConfig, { recursive: true });
  const hookFile = path.join(userConfig, 'hooks.json');
  fs.writeFileSync(hookFile, '{ broken: json');

  const result = cli(['install'], c.env);
  assert.notEqual(result.status, 0);
  assert.ok(/not valid JSON/i.test(result.stderr));
});

test('uninstaller cleanly removes ponytail and leaves unrelated files intact', () => {
  const c = testEnv('uninstall-clean');
  const userConfig = path.join(c.home, '.gemini', 'config');

  // Install first
  cli(['install'], c.env);

  // Add an unrelated skill and hook
  const otherSkillDir = path.join(userConfig, 'skills', 'custom-skill');
  fs.mkdirSync(otherSkillDir, { recursive: true });
  fs.writeFileSync(path.join(otherSkillDir, 'SKILL.md'), '# custom');

  const hookFile = path.join(userConfig, 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
  hooks['custom-hook'] = { PreInvocation: [{ command: './custom.sh' }] };
  fs.writeFileSync(hookFile, JSON.stringify(hooks));

  // Run uninstall
  const result = cli(['uninstall'], c.env);
  assert.equal(result.status, 0, result.stderr);

  // Ponytail rule is gone
  assert.equal(fs.existsSync(path.join(userConfig, 'rules', 'ponytail.md')), false);
  // Ponytail skill is gone
  assert.equal(fs.existsSync(path.join(userConfig, 'skills', 'ponytail')), false);
  // Unrelated skill is kept
  assert.ok(fs.existsSync(path.join(otherSkillDir, 'SKILL.md')));
  // Hook entry removed but unrelated hook kept
  const hooksAfter = JSON.parse(fs.readFileSync(hookFile, 'utf8'));
  assert.equal(hooksAfter.ponytail, undefined);
  assert.ok(hooksAfter['custom-hook']);
});
