import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const srcRoot = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return walk(fullPath);
    }
    return fullPath;
  });
}

function readProjectFiles() {
  return walk(srcRoot).filter((filePath) => /\.(ts|tsx)$/.test(filePath));
}

describe('i18n organization', () => {
  it('keeps defineMessage out of runtime t() calls', () => {
    const violations = readProjectFiles()
      .filter((filePath) => !filePath.includes('__tests__'))
      .filter((filePath) => readFileSync(filePath, 'utf8').includes('t(defineMessage('))
      .map((filePath) => relative(srcRoot, filePath));

    expect(violations).toEqual([]);
  });

  it('does not pass raw localized Chinese strings to requestData fallbacks', () => {
    const violationPattern = /requestData\([^\n]*'[^']*[一-龥][^']*'/;
    const violations = readProjectFiles()
      .filter((filePath) => !filePath.includes('__tests__'))
      .filter((filePath) => violationPattern.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => relative(srcRoot, filePath));

    expect(violations).toEqual([]);
  });
});
