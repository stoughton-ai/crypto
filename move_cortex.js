const fs = require('fs');
const content = fs.readFileSync('src/components/AgentDashboard.tsx', 'utf-8');
const lines = content.split('\n');

const ledgerStartCode = '{/* CORTEX PORTFOLIO COMMAND (THE FINANCIAL ENGINE ROOM) */}';
const ledgerStart = lines.findIndex(l => l.includes(ledgerStartCode));

let ledgerEnd = ledgerStart;
let depth = 0;
let foundDiv = false;
for (let i = ledgerStart; i < lines.length; i++) {
    const l = lines[i];
    const openTags = (l.match(/<div/g) || []).length;
    const closeTags = (l.match(/<\/div/g) || []).length;
    if (openTags > 0) {
        depth += openTags;
        foundDiv = true;
    }
    if (closeTags > 0) {
        depth -= closeTags;
    }
    if (foundDiv && depth === 0) {
        ledgerEnd = i;
        break;
    }
}

console.log('Ledger lines:', ledgerStart, 'to', ledgerEnd);

const controlStartCode = '{/* CORTEX INTELLIGENCE CONSOLE (NASA NASA STYLE) */}';
const controlStartOuter = lines.findIndex(l => l.includes(controlStartCode));
const wrapperStart = controlStartOuter + 1;

let newLines = [...lines];

// Extract ledger chunk
const ledgerChunk = newLines.splice(ledgerStart, ledgerEnd - ledgerStart + 1);

// Move the ledger to right after the wrapper div opens
// The wrapper is lines[controlStartOuter + 1] -> <div className="mt-8 space-y-6">
// So we want to insert right after controlStartOuter + 1 (i.e. at controlStartOuter + 2)
newLines.splice(controlStartOuter + 2, 0, ...ledgerChunk);

fs.writeFileSync('src/components/AgentDashboard.tsx', newLines.join('\n'));
console.log('Moved Ledger up!');
