const fs = require('fs');
const path = require('path');

const E2E_DIR = path.join(__dirname, 'e2e');
let hasErrors = false;

function error(msg) {
  console.error(`❌ ${msg}`);
  hasErrors = true;
}

function success(msg) {
  console.log(`✅ ${msg}`);
}

const allFiles = fs.readdirSync(E2E_DIR).filter(f => f !== 'README.md');
const claimedFiles = new Set();

// 1. Identify all suites by their .httpt template
const baseNames = allFiles
  .filter(f => f.endsWith('.httpt'))
  .map(f => f.replace('.httpt', ''));

// 2. Verify each suite
for (const base of baseNames) {
  console.log(`\nVerifying Suite: ${base}`);

  const requiredFiles = ['.httpt', '.data.json', '.httpt-r', '.httpt-ir', '.httpt-map'];
  const jsonFiles = ['.data.json', '.httpt-ir', '.httpt-map'];

  for (const ext of requiredFiles) {
    const fileName = `${base}${ext}`;
    const filePath = path.join(E2E_DIR, fileName);
    claimedFiles.add(fileName);

    if (!fs.existsSync(filePath)) {
      error(`Missing required file: ${fileName}`);
    } else if (jsonFiles.includes(ext)) {
      try {
        JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        success(`${fileName} is valid JSON.`);
      } catch (e) {
        error(`Invalid JSON in ${fileName}: ${e.message}`);
      }
    } else {
      success(`${fileName} exists.`);
    }
  }

  // 3. Claim stream files (e.g., 001-simple-get-stream-0.pdf)
  const streamRegex = new RegExp(`^${base}-stream-\\d+`);
  const streamFiles = allFiles.filter(f => streamRegex.test(f));
  streamFiles.forEach(f => {
    claimedFiles.add(f);
    success(`Found stream file: ${f}`);
  });
}

// 4. Check for orphans (files that don't belong to any suite)
const orphans = allFiles.filter(f => !claimedFiles.has(f));
if (orphans.length > 0) {
  error(`Found orphaned or improperly named files in e2e/: ${orphans.join(', ')}`);
}

if (hasErrors) {
  console.error('\n❌ Verification Failed. Please fix the errors above.');
  process.exit(1);
} else {
  console.log(`\n🎉 All ${baseNames.length} test suites verified successfully!`);
}
