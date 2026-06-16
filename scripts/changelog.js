#!/usr/bin/env node
'use strict';
/*
 * Print the CHANGELOG.md section for a given version (used by CI to set the
 * GitHub Release notes). Usage: node scripts/changelog.js 1.0.2
 * Falls back to a generic line if the version has no section.
 */
const fs = require('fs');
const path = require('path');

const version = (process.argv[2] || '').replace(/^v/, '').trim();
const file = path.join(__dirname, '..', 'CHANGELOG.md');

function extract(md, ver) {
  const lines = md.split(/\r?\n/);
  const headRe = new RegExp('^##\\s+v?' + ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$|—|-)');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headRe.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

let notes = null;
try { notes = extract(fs.readFileSync(file, 'utf8'), version); } catch (_) {}
if (!notes) notes = `Release v${version}.`;
process.stdout.write(notes + '\n');
