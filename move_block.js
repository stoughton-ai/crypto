const fs = require('fs');
const filepath = '/Users/chris/Antigravity/Semaphore10/src/components/AgentDashboard.tsx';
let content = fs.readFileSync(filepath, 'utf8');

const synopsisStartString = "                {/* CORTEX NEURAL SYNOPSIS (SELF-CORRECTION FEEDBACK) */}";
const portfolioCommandStartString = "                {/* CORTEX PORTFOLIO COMMAND (THE FINANCIAL ENGINE ROOM) */}";

const synopsisStart = content.indexOf(synopsisStartString);
const portfolioStart = content.indexOf(portfolioCommandStartString);

if (synopsisStart === -1 || portfolioStart === -1) {
    console.error("Could not find delimiters");
    process.exit(1);
}

// Extract the synopsis block
const synopsisBlock = content.substring(synopsisStart, portfolioStart);

// Remove it from current position
content = content.substring(0, synopsisStart) + content.substring(portfolioStart);

const watchlistStartString = "                {/* CORTEX WATCHLIST (THE TACTICAL GRID) */}";
const watchlistStart = content.indexOf(watchlistStartString);

if (watchlistStart === -1) {
    console.error("Could not find watchlist delimiter");
    process.exit(1);
}

// Insert before watchlist
content = content.substring(0, watchlistStart) + synopsisBlock + content.substring(watchlistStart);

fs.writeFileSync(filepath, content);
console.log("Successfully moved block.");
