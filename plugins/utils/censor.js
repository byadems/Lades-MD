/**
 * Küfür sansürü - Tüm pluginlerden erişilebilir.
 * censorBadWords(text): Metindeki yasaklı kelimeleri yıldızla maskeleler.
 * containsBadWord(text): Metinde yasaklı kelime var mı kontrol eder.
 * makeBadWordRegex(word): Leetspeak varyantlarını yakalayan fuzzy regex üretir.
 */

const badWords = [
  "amk","aq","mk","orospu","orospu çocuğu","orospu cocugu","oç","o.ç","amcık","amına","amını","amina", 
"sik","sikerim","siktir","sikim","sikeyim","sikiyim","sikti","sikik","yarrak","yarak","yarram","yarrağım",
"piç","pezevenk","kahpe","kaltak","kaşar","puşt","ibne","ibine","ibneyim","şerefsiz","serefsiz",
"mal","salak","aptal","gerizekalı","dalyarak","dingil","yavşak","yavsak","göt","götveren","gavat",
  "döl","bok","bok gibi","amına koyayım","amına koyim","amına kodum","siktir git",
"fuck","fucking","pussy","bitch","asshole","bastard"
];

function makeBadWordRegex(word) {
  const pattern = word
    .replace(/a/g, "[a4@àáâã]")
    .replace(/i/g, "[i1!İîı]")
    .replace(/o/g, "[o0öòóô]")
    .replace(/u/g, "[uüùúû]")
    .replace(/s/g, "[s5$ş]")
    .replace(/c/g, "[cç]")
    .replace(/g/g, "[gğ9]")
    .replace(/e/g, "[e3éèê]")
    .replace(/\s+|\./g, "(\\s|\\.|-|_)*");
  return new RegExp(`\\b${pattern}\\b`, "iu");
}

const _sortedWords = [...badWords].sort((a, b) => b.length - a.length);
const _fuzzyRegexes = badWords.map(makeBadWordRegex);

function containsBadWord(text) {
  if (!text || typeof text !== "string") return false;
  return _fuzzyRegexes.some((rx) => rx.test(text));
}

function censorBadWords(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const word of _sortedWords) {
    if (!word || word.length < 2) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "gi");
    result = result.replace(regex, (m) => {
      if (m.length <= 2) return "*".repeat(m.length);
      return m[0] + "*".repeat(m.length - 2) + m[m.length - 1];
    });
  }
  return result;
}

module.exports = { censorBadWords, containsBadWord, makeBadWordRegex, badWords };
