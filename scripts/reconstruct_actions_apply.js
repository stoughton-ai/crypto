const fs = require('fs');
const path = require('path');

const restoredPath = '/Users/chris/Antigravity/Semaphore10/restored_actions.ts';
const transcriptPath = '/Users/chris/.gemini/antigravity/brain/47808aa7-0bed-41a5-bfdc-b5d261b62f40/.system_generated/logs/transcript.jsonl';
const outputPath = '/Users/chris/Antigravity/Semaphore10/src/app/actions.ts';

if (!fs.existsSync(restoredPath)) {
  console.error("restored_actions.ts not found!");
  process.exit(1);
}
if (!fs.existsSync(transcriptPath)) {
  console.error("transcript.jsonl not found!");
  process.exit(1);
}

let content = fs.readFileSync(restoredPath, 'utf8');
console.log(`Starting with restored_actions.ts: ${content.length} characters.`);

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
let patchCount = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const step = JSON.parse(line);
    if (step.tool_calls) {
      for (const tc of step.tool_calls) {
        if (tc.name === 'replace_file_content') {
          const targetFile = tc.args.TargetFile;
          if (targetFile && targetFile.includes('actions.ts')) {
            const targetContent = tc.args.TargetContent;
            const replacementContent = tc.args.ReplacementContent;
            
            if (targetContent && replacementContent) {
              console.log(`\nApplying Patch at Step ${step.step_index} (${step.created_at})`);
              console.log(`Instruction: ${tc.args.Instruction}`);
              
              if (content.includes(targetContent)) {
                content = content.replace(targetContent, replacementContent);
                console.log(`✅ Successfully applied patch! New length: ${content.length}`);
                patchCount++;
              } else {
                console.warn(`❌ Warning: TargetContent not found for this patch!`);
                // Let's print a small snippet of targetContent to see what went wrong
                console.log(`Target snippet: ${targetContent.substring(0, 100)}...`);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore invalid JSON lines
  }
}

fs.writeFileSync(outputPath, content, 'utf8');
console.log(`\nReconstructed actions.ts saved to ${outputPath}. Applied ${patchCount} patches.`);
