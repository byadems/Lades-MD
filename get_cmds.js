const fs = require('fs');
const path = require('path');

const pluginsDir = path.join(process.cwd(), 'plugins');
const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') && f !== 'komutlar.js');
let cmds = [];

for (let file of files) {
    let content = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
    let regex = /pattern:\s*(['"`])(.*?)\1/g;
    let match;
    while((match = regex.exec(content)) !== null) {
        let pattern = match[2].split(' ')[0].replace(/\\/g, '');
        
        // Find desc near it
        let snippet = content.slice(match.index, match.index + 300);
        let descMatch = snippet.match(/desc:\s*(['"`]|Lang\.)(.*?)['"`,\n]/);
        let desc = descMatch ? descMatch[2].trim() : "NO DESC";
        
        cmds.push({pattern, desc, file});
    }
}
fs.writeFileSync('cmd_extracted.json', JSON.stringify(cmds, null, 2));
console.log('Extracted', cmds.length, 'commands');
