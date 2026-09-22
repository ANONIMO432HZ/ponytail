#!/usr/bin/env node
// ponytail — install or remove ponytail customizations in Antigravity IDE:
// ~/.gemini/config (default) or <cwd>/.agents (--project).
//
// Installs:
//   1. rules/ponytail.md (always-on rule)
//   2. skills/<name>/SKILL.md (native skills: ponytail, ponytail-review, etc.)
//   3. hooks.json (PreInvocation hook running ponytail-mode-tracker.js)
//
//   node scripts/antigravity.js install [--project]
//   node scripts/antigravity.js uninstall [--project]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isShellSafe } = require('../hooks/ponytail-config');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'hooks', 'antigravity-hooks.json');
const SOURCE_RULE = path.join(ROOT, '.agents', 'rules', 'ponytail.md');
const SOURCE_SKILLS = path.join(ROOT, 'skills');

const PONYTAIL_HOOK = /ponytail-[\w-]+\.js/;
const PONYTAIL_SKILLS = [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
  'ponytail-gain',
  'ponytail-help',
];

function isPonytailHook(entry) {
  return Boolean(entry && typeof entry.command === 'string' && PONYTAIL_HOOK.test(entry.command));
}

function baseDir(scope) {
  return scope === 'project'
    ? path.join(process.cwd(), '.agents')
    : path.join(os.homedir(), '.gemini', 'config');
}

function hooksPath(scope) {
  return path.join(baseDir(scope), 'hooks.json');
}

function rulesPath(scope) {
  return path.join(baseDir(scope), 'rules', 'ponytail.md');
}

function skillsDir(scope) {
  return path.join(baseDir(scope), 'skills');
}

function readConfig(file) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  return config;
}

function writeConfig(file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function removeDirIfEmpty(dir) {
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (e) {
    // best-effort cleanup
  }
}

function ponytailHookEntries() {
  const root = ROOT.replace(/\\/g, '/');
  if (!isShellSafe(root)) {
    throw new Error('ponytail is checked out at a path with shell metacharacters (' + ROOT +
      '); move it, or copy hooks/antigravity-hooks.json by hand and quote the path for your shell');
  }
  const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'));
  const hookObj = {};
  for (const [hookName, events] of Object.entries(template)) {
    hookObj[hookName] = {};
    for (const [event, entries] of Object.entries(events)) {
      if (Array.isArray(entries)) {
        hookObj[hookName][event] = entries.map((entry) => ({
          ...entry,
          command: entry.command.replace(/PONYTAIL_DIR/g, root),
        }));
      }
    }
  }
  return hookObj;
}

function install(scope) {
  const targetBase = baseDir(scope);

  // 1. Install Rule
  const ruleDest = rulesPath(scope);
  fs.mkdirSync(path.dirname(ruleDest), { recursive: true });
  fs.copyFileSync(SOURCE_RULE, ruleDest);

  // 2. Install Skills
  const targetSkills = skillsDir(scope);
  for (const skillName of PONYTAIL_SKILLS) {
    const srcFile = path.join(SOURCE_SKILLS, skillName, 'SKILL.md');
    if (fs.existsSync(srcFile)) {
      const destDir = path.join(targetSkills, skillName);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcFile, path.join(destDir, 'SKILL.md'));
    }
  }

  // 3. Install Hooks
  const hookFile = hooksPath(scope);
  const config = readConfig(hookFile);
  const hookEntries = ponytailHookEntries();
  for (const [k, v] of Object.entries(hookEntries)) {
    config[k] = v;
  }
  writeConfig(hookFile, config);

  return targetBase;
}

function uninstall(scope) {
  const targetBase = baseDir(scope);
  if (!fs.existsSync(targetBase)) return null;

  let changed = false;

  // 1. Uninstall Hooks
  const hookFile = hooksPath(scope);
  if (fs.existsSync(hookFile)) {
    const config = readConfig(hookFile);
    if (config.ponytail) {
      delete config.ponytail;
      changed = true;
      if (Object.keys(config).length === 0) {
        fs.unlinkSync(hookFile);
      } else {
        writeConfig(hookFile, config);
      }
    }
  }

  // 2. Uninstall Rule
  const ruleDest = rulesPath(scope);
  if (fs.existsSync(ruleDest)) {
    fs.unlinkSync(ruleDest);
    changed = true;
    removeDirIfEmpty(path.dirname(ruleDest));
  }

  // 3. Uninstall Skills
  const targetSkills = skillsDir(scope);
  for (const skillName of PONYTAIL_SKILLS) {
    const destDir = path.join(targetSkills, skillName);
    const destFile = path.join(destDir, 'SKILL.md');
    if (fs.existsSync(destFile)) {
      fs.unlinkSync(destFile);
      changed = true;
      removeDirIfEmpty(destDir);
    }
  }
  removeDirIfEmpty(targetSkills);

  // If scope is project and .agents is now empty, clean it up
  if (scope === 'project') {
    removeDirIfEmpty(targetBase);
  }

  return changed ? targetBase : null;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const action = args[0];
  const scope = args.includes('--project') ? 'project' : 'user';
  try {
    if (action === 'install') {
      const target = install(scope);
      console.log('Installed ponytail in ' + target);
      console.log('Antigravity IDE discovers customizations automatically; open a new chat to activate.');
    } else if (action === 'uninstall') {
      const target = uninstall(scope);
      console.log(target
        ? 'Removed ponytail from ' + target
        : 'No ponytail customizations in ' + baseDir(scope));
    } else {
      console.error('usage: node scripts/antigravity.js install|uninstall [--project]');
      process.exit(1);
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      console.error(hooksPath(scope) + ' is not valid JSON; nothing was changed, fix it by hand (' + e.message + ')');
    } else {
      console.error(e.message);
    }
    process.exit(1);
  }
}

module.exports = {
  PONYTAIL_SKILLS,
  baseDir,
  hooksPath,
  install,
  isPonytailHook,
  rulesPath,
  skillsDir,
  uninstall,
};
