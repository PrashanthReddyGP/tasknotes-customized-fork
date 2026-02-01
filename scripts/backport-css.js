const fs = require('fs');
const path = require('path');

// Determine paths
const rootDir = path.resolve(__dirname, '..');
const compiledCssPath = path.join(rootDir, 'reference', 'styles.css');
const stylesDir = path.join(rootDir, 'styles');
const buildConfigPath = path.join(rootDir, 'build-css.mjs');

function backportCss() {
    console.log(`Source CSS: ${compiledCssPath}`);

    if (!fs.existsSync(compiledCssPath)) {
        console.error(`ERROR: Source file not found!`);
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(compiledCssPath, 'utf8');
        const regex = /\/\* ===== (.*?) ===== \*\/\r?\n?/;
        const parts = content.split(regex);

        if (parts.length < 3) {
            console.error("WARNING: No sections found! Check regex or contents.");
            return;
        }

        // Mapping for awkward header names to clean filenames
        const nameMapping = {
            'clean list view styling - no inheritance': 'list-view-base.css',
            'task-specific enhancements': 'task-enhancements.css'
        };

        let updatedCount = 0;
        let createdCount = 0;
        let buildConfigUpdated = false;

        // Read build config
        let buildConfig = "";
        if (fs.existsSync(buildConfigPath)) {
            buildConfig = fs.readFileSync(buildConfigPath, 'utf8');
        }

        for (let i = 1; i < parts.length; i += 2) {
            const headerName = parts[i].trim();
            const cssContent = parts[i + 1];

            let candidateName = headerName.toLowerCase();
            // Apply mapping if exists
            if (nameMapping[candidateName]) {
                candidateName = nameMapping[candidateName];
            }

            const filePath = path.join(stylesDir, candidateName);
            const relativePath = `styles/${candidateName}`;

            const cleanContent = cssContent.trim() + '\n';

            // Check if file exists
            if (fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, cleanContent, 'utf8');
                console.log(`✅ Updated: ${candidateName}`);
                updatedCount++;
            } else {
                fs.writeFileSync(filePath, cleanContent, 'utf8');
                console.log(`✨ Created: ${candidateName}`);
                createdCount++;

                // Add to build config if not present
                if (buildConfig && !buildConfig.includes(`'${relativePath}'`) && !buildConfig.includes(`"${relativePath}"`)) {
                    // Try to insert before the closing bracket of CSS_FILES
                    const arrayEndRegex = /];\s*const MAIN_CSS_TEMPLATE/;
                    // Or usually just look for the last element?
                    // Let's simply replace `];` with the new entry + `];`
                    // But `];` might appear multiple times.
                    // CSS_FILES definition ends with `];`.

                    // Specific replacement for build-css.mjs structure
                    if (buildConfig.includes('const CSS_FILES = [')) {
                        // Find the closing bracket for CSS_FILES
                        // We assume specific formatting or standard JS.
                        // Simple heuristic: valid until next `const` or function.

                        // Safer: replace the last element in the list? 
                        // Or just regex replace: `('styles/.*?'\s*?)\n];`
                        // Let's try to append to the list.

                        const insertionPoint = buildConfig.indexOf('];');
                        if (insertionPoint > -1) {
                            const entry = `    '${relativePath}', // Auto-added\n`;
                            buildConfig = buildConfig.slice(0, insertionPoint) + entry + buildConfig.slice(insertionPoint);
                            console.log(`   ➕ Added to build-css.mjs`);
                            buildConfigUpdated = true;
                        }
                    }
                }
            }
        }

        if (buildConfigUpdated) {
            fs.writeFileSync(buildConfigPath, buildConfig, 'utf8');
            console.log(`💾 Saved updated build-css.mjs`);
        }

        console.log(`\nDONE. Updated: ${updatedCount}, Created: ${createdCount}`);

    } catch (err) {
        console.error(`FATAL ERROR: ${err.message}`);
    }
}

backportCss();
