/**
 * Küfür sansürü - Tüm pluginlerden erişilebilir.
 * censorBadWords(text): Metindeki yasaklı kelimeleri yıldızla maskeleler.
 */

const badWords = [
  "amk", "amq", "aq", "orospu", "orospu cocugu", "orospuçocuğu",
  "göt", "got", "sik", "sikeyim", "siktir", "sikerim", "amına", "amina",
  "piç", "pic", "pezevenk", "kahpe", "döl", "dol", "yarrak", "yarak",
  "bok", "boktan", "bok gibi", "mal", "salak", "aptal", "gerizekalı",
  "fuck", "shit", "bitch", "ass", "dick", "pussy", "cunt", "whore",
  "nigger", "nigga", "faggot", "retard", "fucking", "bullshit",
];

/**
 * Metindeki yasaklı kelimeleri yıldız (*) ile maskeleler.
 * @param {string} text - Sansürlenecek metin
 * @returns {string} Sansürlenmiş metin
 */
function censorBadWords(text) {
  if (!text || typeof text !== "string") return text;
  let result = text;
  for (const word of badWords) {
    if (!word || word.length < 2) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, (m) => "*".repeat(m.length));
  }
  return result;
}

module.exports = { censorBadWords, badWords };
