const fs = require('fs');
const content = fs.readFileSync('d:/Git_Projects/tasknotes/reference/styles.css', 'utf8');
const lines = content.split('\n');
lines.forEach((line, index) => {
    if (line.includes('===== ')) {
        console.log(`${index + 1}: ${line.trim()}`);
    }
});
