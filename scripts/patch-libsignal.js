#!/usr/bin/env node
/**
 * postinstall patch: libsignal-node session_record.js içindeki
 * verbose console.info / console.warn çağrılarını kaldırır.
 *
 * Sorun: libsignal her session open/close/remove işleminde
 * SessionEntry objesini console.info ile dump ediyor.
 * Bu, üretim loglarını devasa Buffer çıktılarıyla dolduruyor.
 *
 * Bu script, npm install sonrası otomatik çalışarak ilgili satırları
 * yorum satırına çevirir. Güvenli: dosya bulunamazsa sessizce çıkar.
 */

const fs = require("fs");
const path = require("path");

const POSSIBLE_PATHS = [
  // Baileys'in kendi node_modules'undaki libsignal
  path.join(__dirname, "..", "node_modules", "baileys", "node_modules", "libsignal", "src", "session_record.js"),
  // Hoisted (flat) node_modules
  path.join(__dirname, "..", "node_modules", "libsignal", "src", "session_record.js"),
];

const REPLACEMENTS = [
  // closeSession
  {
    from: /console\.info\(\s*["']Closing session:?["']\s*,\s*session\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
  // openSession
  {
    from: /console\.info\(\s*["']Opening session:?["']\s*,\s*session\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
  // removeOldSessions
  {
    from: /console\.info\(\s*["']Removing old closed session:?["']\s*,\s*oldestSession\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
  // "Session already closed" warning with session dump
  {
    from: /console\.warn\(\s*["']Session already closed["']\s*,\s*session\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
  // "Session already open" warning
  {
    from: /console\.warn\(\s*["']Session already open["']\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
  // session_builder.js style: "Closing stale open session..."
  {
    from: /console\.log\(\s*["']Closing stale open session[^"']*["']\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
  {
    from: /console\.log\(\s*["']Closing open session[^"']*["']\s*\)/g,
    to: "/* patched: verbose log removed */",
  },
];

let patched = 0;

for (const filePath of POSSIBLE_PATHS) {
  try {
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, "utf-8");
    let changed = false;

    for (const { from, to } of REPLACEMENTS) {
      const updated = content.replace(from, to);
      if (updated !== content) {
        content = updated;
        changed = true;
        patched++;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`✅ libsignal patched: ${filePath} (${patched} replacement(s))`);
    }
  } catch (err) {
    console.warn(`⚠️ libsignal patch warning: ${err.message}`);
  }
}

// Also patch session_builder.js (contains "Closing stale open session" log)
const BUILDER_PATHS = [
  path.join(__dirname, "..", "node_modules", "baileys", "node_modules", "libsignal", "src", "session_builder.js"),
  path.join(__dirname, "..", "node_modules", "libsignal", "src", "session_builder.js"),
];

const BUILDER_REPLACEMENTS = [
  {
    from: /console\.log\(\s*["']Closing stale open session[^"']*["'][^)]*\)/g,
    to: "/* patched: verbose log removed */",
  },
  {
    from: /console\.log\(\s*["']Closing open session[^"']*["'][^)]*\)/g,
    to: "/* patched: verbose log removed */",
  },
];

for (const filePath of BUILDER_PATHS) {
  try {
    if (!fs.existsSync(filePath)) continue;

    let content = fs.readFileSync(filePath, "utf-8");
    let changed = false;

    for (const { from, to } of BUILDER_REPLACEMENTS) {
      const updated = content.replace(from, to);
      if (updated !== content) {
        content = updated;
        changed = true;
        patched++;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`✅ libsignal patched: ${filePath}`);
    }
  } catch (err) {
    console.warn(`⚠️ libsignal patch warning: ${err.message}`);
  }
}

if (patched === 0) {
  console.log("ℹ️ libsignal patch: hedef dosya bulunamadı veya zaten patch'lenmiş.");
} else {
  console.log(`✅ libsignal patch tamamlandı: toplam ${patched} değişiklik.`);
}
