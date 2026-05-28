const fs = require('fs');
const path = require('path');

const transcriptPath = '/Users/chris/.gemini/antigravity/brain/47808aa7-0bed-41a5-bfdc-b5d261b62f40/.system_generated/logs/transcript.jsonl';
if (!fs.existsSync(transcriptPath)) {
  console.error("Transcript not found at", transcriptPath);
  process.exit(1);
}

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
console.log(`Read ${lines.length} lines from transcript.`);

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const step = JSON.parse(line);
    if (step.tool_calls) {
      for (const tc of step.tool_calls) {
        if (tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content' || tc.name === 'write_to_file') {
          const target = tc.args.TargetFile || tc.args.TargetFile;
          if (target && target.includes('actions.ts')) {
            console.log(`\n--- STEP ${step.step_index} (${step.created_at}) ---`);
            console.log(`Tool: ${tc.name}`);
            console.log(`Instruction: ${tc.args.Instruction}`);
            console.log(`Description: ${tc.args.Description}`);
            if (tc.args.ReplacementContent) {
              console.log(`ReplacementContent Length: ${tc.args.ReplacementContent.length}`);
            }
            if (tc.args.CodeContent) {
              console.log(`CodeContent Length: ${tc.args.CodeContent.length}`);
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore invalid JSON lines
  }
}
