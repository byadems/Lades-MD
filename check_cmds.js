const fs = require('fs');

const cmds = JSON.parse(fs.readFileSync('cmd_extracted.json'));
const komutlarText = fs.readFileSync('plugins/komutlar.js', 'utf8');

let matchRegex = /"([^"]*?\.)(\w+)\\n(.*?)\\n/g;
let match;
let missing = [];

while ((match = matchRegex.exec(komutlarText)) !== null) {
    let name = match[2];
    let desc = match[3];

    let found = cmds.find(c => c.pattern === name || c.pattern === name.replace(/ı/g, 'i'));
    if (!found) {
        missing.push({name, desc});
    }
}

console.log("Missing commands in plugins:");
missing.forEach(m => {
    console.log(`\n- .${m.name}`);
    console.log(`  Komutlar.js Desc: ${m.desc}`);
    let candidates = cmds.filter(c => c.desc && (m.desc.toLowerCase().includes(c.desc.toLowerCase().substring(0, 20)) || c.desc.toLowerCase().includes(m.desc.toLowerCase().substring(0, 20))));
    if (candidates.length > 0) {
        console.log(`  Regex Candidates: ${candidates.map(c => '.' + c.pattern).join(', ')}`);
    }
});
