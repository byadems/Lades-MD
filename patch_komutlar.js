const fs = require('fs');
const komutlarPath = 'plugins/komutlar.js';
let content = fs.readFileSync(komutlarPath, 'utf8');

// Fix the getmute/otodurum issue: It should be getmute.
content = content.replace(/"⏲️ \.otodurum\\nAyarlanmış otomatik/g, '"⏲️ .getmute\\nAyarlanmış otomatik');

// Fix ig and detectlang removal:
content = content.replace(/"🔍 \.ig\\nInstagram'da hesap bilgisi araştırır\.\\n\\n"\s*\+\s*/g, '');
content = content.replace(/"🈷️ \.detectlang\\nYanıtlanan mesajın dilini bulmaya çalışır\.\\n\\n"\s*\+\s*/g, '');

// Clean any accidental double empty quotes if occurred
content = content.replace(/""\s*\+\s*""\s*\+\s*/g, '"" +\n    ');

fs.writeFileSync(komutlarPath, content);
console.log('Komutlar.js refined successfully!');
