const fs = require('fs');
const path = require('path');

const refPath = path.resolve(__dirname, '../reference/styles.css');
const startPath = path.resolve(__dirname, '../styles.css');

function getSections(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${filePath}`);
        return new Map();
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const parts = content.split(/\/\* ===== (.*?) ===== \*\/\r?\n?/);
    const sections = new Map();
    for (let i = 1; i < parts.length; i += 2) {
        sections.set(parts[i].trim(), parts[i + 1]);
    }
    return sections;
}

const refSections = getSections(refPath);
const buildSections = getSections(startPath);

console.log(`Reference has ${refSections.size} sections.`);
console.log(`Build has ${buildSections.size} sections.`);

// Compare keys
const refKeys = Array.from(refSections.keys());
const buildKeys = Array.from(buildSections.keys());

const onlyInRef = refKeys.filter(k => !buildSections.has(k));
const onlyInBuild = buildKeys.filter(k => !refSections.has(k));

if (onlyInRef.length > 0) {
    console.log('Sections only in Reference:', onlyInRef);
}
if (onlyInBuild.length > 0) {
    console.log('Sections only in Build:', onlyInBuild);
}

// Compare sizes of common sections
const common = refKeys.filter(k => buildSections.has(k));
common.forEach(k => {
    const refLen = refSections.get(k).length;
    const buildLen = buildSections.get(k).length;
    if (Math.abs(refLen - buildLen) > 10) { // fuzzy match
        console.log(`Size diff for ${k}: Ref=${refLen}, Build=${buildLen}`);
    }
});
