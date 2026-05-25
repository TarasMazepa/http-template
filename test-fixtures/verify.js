const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { E2E_DIR } = require('../js/packages/test-utils/index.js');

describe('E2E Matrix Validation', () => {
  it('should verify all required files exist and are well-formed', () => {
    const allFiles = fs.readdirSync(E2E_DIR).filter(f => f !== 'README.md' && f !== 'TEST_MATRIX.md');
    const claimedFiles = new Set();

    // 1. Identify all suites by their .httpt template
    const baseNames = allFiles
      .filter(f => f.endsWith('.httpt'))
      .map(f => f.replace('.httpt', ''));

  // 2. Verify each suite
  for (const base of baseNames) {
    const isErrorFixture = fs.existsSync(path.join(E2E_DIR, `${base}.error.json`));
    let requiredFiles = ['.httpt', '.data.json', '.httpt-r', '.httpt-ir', '.httpt-map'];
    if (isErrorFixture) {
      requiredFiles = ['.httpt', '.data.json', '.error.json'];
      claimedFiles.add(`${base}.error.json`);
    }

    const jsonFiles = ['.data.json', '.httpt-ir', '.httpt-map', '.error.json'];

      for (const ext of requiredFiles) {
        const fileName = `${base}${ext}`;
        const filePath = path.join(E2E_DIR, fileName);
        claimedFiles.add(fileName);

        if (!fs.existsSync(filePath)) {
          assert.fail(`Missing required file: ${fileName}`);
        } else if (jsonFiles.includes(ext)) {
          try {
            JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          } catch (e) {
            assert.fail(`Invalid JSON in ${fileName}: ${e.message}`);
          }
        }
      }

      // 3. Claim stream files for each required file (e.g., 006-post-provided.httpt-ir-provided-stream-0)
      for (const ext of requiredFiles) {
        const fileName = `${base}${ext}`;
        const streamRegex = new RegExp(`^${fileName.replace(/\./g, '\\.')}-provided-stream-\\d+$`);
        const streamFiles = allFiles.filter(f => streamRegex.test(f));
        streamFiles.forEach(f => {
          claimedFiles.add(f);
        });
      }
    }

    // 4. Check for orphans (files that don't belong to any suite)
    const orphans = allFiles.filter(f => !claimedFiles.has(f));
    if (orphans.length > 0) {
      assert.fail(`Found orphaned or improperly named files in e2e/: ${orphans.join(', ')}`);
    }
  });
});
