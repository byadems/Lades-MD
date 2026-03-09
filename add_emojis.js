const fs = require('fs');
const content = fs.readFileSync('replace_strings.js', 'utf8');
const objMatch = content.match(/const translations = ({[\s\S]*?});/);
if (objMatch) {
    const obj = eval('(' + objMatch[1] + ')');
    const newTranslations = {};
    for (let k in obj) {
        let val = obj[k];
        let newVal = val;
        // Skip if already contains specific emojis
        if (val.includes('❌') || val.includes('✅') || val.includes('⚠') || val.includes('🛡️') || val.includes('🗑️') || val.includes('🖼️') || val.includes('🎵') || val.includes('🎬') || val.includes('🔍') || val.includes('⬇️') || val.includes('⚙️') || val.includes('💭') || val.includes('✨') || val.includes('🤖') || val.includes('🌙') || val.includes('🎯') || val.includes('📝') || val.includes('📞') || val.includes('🔇') || val.includes('🚀') || val.match(/[\u2700-\u27BF]|[\uE000-\uF8FF]|[-]|[-]|[\u2011-\u26FF]|[-]/)) {
            continue; 
        }

        // simple matching
        if (val.toLowerCase().includes('hata') || val.toLowerCase().includes('başarısız') || val.toLowerCase().includes('geçersiz') || val.toLowerCase().includes('bulunamadı') || val.toLowerCase().includes('değil')) {
            newVal = newVal.replace(/^([_*]*)/, '$1❌ ');
        } else if (val.toLowerCase().includes('başarı') || val.toLowerCase().includes('açıldı') || val.toLowerCase().includes('etkin') || val.toLowerCase().includes('aktif')) {
            newVal = newVal.replace(/^([_*]*)/, '$1✅ ');
        } else if (val.toLowerCase().includes('uyarı') || val.toLowerCase().includes('lütfen') || val.toLowerCase().includes('gerekli') || val.toLowerCase().includes('emin')) {
            newVal = newVal.replace(/^([_*]*)/, '$1⚠️ ');
        } else if (val.toLowerCase().includes('aranıyor') || val.toLowerCase().includes('arama')) {
            newVal = newVal.replace(/^([_*]*)/, '$1🔍 ');
        } else if (val.toLowerCase().includes('indir') || val.toLowerCase().includes('yüklen')) {
            newVal = newVal.replace(/^([_*]*)/, '$1⬇️ ');
        } else if (val.toLowerCase().includes('video') || val.toLowerCase().includes('film')) {
            newVal = newVal.replace(/^([_*]*)/, '$1🎬 ');
        } else if (val.toLowerCase().includes('ses') || val.toLowerCase().includes('müzik') || val.toLowerCase().includes('şarkı')) {
            newVal = newVal.replace(/^([_*]*)/, '$1🎵 ');
        } else if (val.toLowerCase().includes('silin') || val.toLowerCase().includes('temizle') || val.toLowerCase().includes('kaldırıldı')) {
            newVal = newVal.replace(/^([_*]*)/, '$1🗑️ ');
        } else if (val.toLowerCase().includes('ayar') || val.toLowerCase().includes('güncellen')) {
            newVal = newVal.replace(/^([_*]*)/, '$1⚙️ ');
        } else if (val.toLowerCase().includes('grup')) {
            newVal = newVal.replace(/^([_*]*)/, '$1👥 ');
        } else if (val.toLowerCase().includes('zaman') || val.toLowerCase().includes('süre')) {
            newVal = newVal.replace(/^([_*]*)/, '$1⏰ ');
        } else if (val.toLowerCase().includes('kullanıcı') || val.toLowerCase().includes('kişi')) {
            newVal = newVal.replace(/^([_*]*)/, '$1👤 ');
        } else if (val.toLowerCase().includes('bağlantı') || val.toLowerCase().includes('link')) {
             newVal = newVal.replace(/^([_*]*)/, '$1🔗 ');
        } else if (val.toLowerCase().includes('resim') || val.toLowerCase().includes('görsel') || val.toLowerCase().includes('foto')) {
            newVal = newVal.replace(/^([_*]*)/, '$1🖼️ ');
        } else if (val.toLowerCase().includes('veda') || val.toLowerCase().includes('karşılama')) {
            newVal = newVal.replace(/^([_*]*)/, '$1👋 ');
        } else if (val.toLowerCase().includes('kapat') || val.toLowerCase().includes('engellen')) {
            newVal = newVal.replace(/^([_*]*)/, '$1🚫 ');
        } else {
            newVal = newVal.replace(/^([_*]*)/, '$1💬 ');
        }
        
        // Clean up double spaces
        newVal = newVal.replace('  ', ' ');
        newTranslations[val] = newVal;
    }

    let scriptContent = `const fs = require('fs');
const path = require('path');
const emojiMap = ${JSON.stringify(newTranslations, null, 2)};

function getFiles(dir, filesList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getFiles(filePath, filesList);
    } else if (filePath.endsWith('.js')) {
      filesList.push(filePath);
    }
  }
  return filesList;
}

const allFiles = getFiles(path.join(__dirname, 'plugins'));
let changedFiles = 0;

allFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  for (const [oldStr, newStr] of Object.entries(emojiMap)) {
    content = content.split('"' + oldStr + '"').join('"' + newStr + '"');
    content = content.split("'" + oldStr + "'").join("'" + newStr + "'");
    content = content.split('\`' + oldStr + '\`').join('\`' + newStr + '\`');
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    changedFiles++;
    console.log('Updated with emojis: ' + file);
  }
});
console.log('Emoji replacement complete. ' + changedFiles + ' files updated.');
`;
    fs.writeFileSync('do_emoji.js', scriptContent);
    console.log('Created do_emoji.js');
}
