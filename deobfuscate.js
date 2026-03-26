/**
 * Custom deobfuscator for the  Function("PARAM","body")(proxy)  pattern.
 *
 * Steps:
 *  1. Intercepts Function() constructor to capture the inner code body
 *  2. Identifies the string-decoder function with high confidence
 *  3. Runs the body in a vm sandbox (with a universal stub-proxy for require)
 *     to materialise every decoded string
 *  4. Replaces all decoderFn(0xN) calls with real string literals
 *  5. Resolves literal-array lookups  z9dl8No[0xN] → actual value
 *  6. Beautifies the result with js-beautify
 *
 * Usage:
 *   node deobfuscate.js core/auth.js [core/auth.deobf.js]
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ── helpers ──────────────────────────────────────────────────────────────────

function escapeStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t').replace(/\0/g, '\\0');
}

/** Universal proxy stub – any property access / call returns another stub. */
function makeStub(label) {
  const fn = function () { return makeStub(label + '()'); };
  return new Proxy(fn, {
    get(_, key) {
      if (key === Symbol.toPrimitive || key === 'toString' || key === 'valueOf')
        return () => `[stub:${label}]`;
      if (key === 'then') return undefined; // not a Promise
      return makeStub(`${label}.${String(key)}`);
    },
    set()       { return true; },
    apply(_t, _th, args) { return makeStub(label + '(' + args.length + ')'); },
    construct()  { return makeStub('new ' + label); },
  });
}

const requireStub = (mod) => {
  // Pass through safe built-ins; stub everything else
  const safeBuiltins = ['path', 'fs', 'os', 'crypto', 'events', 'stream', 'util', 'buffer'];
  if (safeBuiltins.includes(mod)) try { return require(mod); } catch (_) {}
  return makeStub(`require('${mod}')`);
};

// ── main ─────────────────────────────────────────────────────────────────────

const [, , inputFile, outputFile] = process.argv;
if (!inputFile) { console.error('Usage: node deobfuscate.js <input.js> [output.js]'); process.exit(1); }

const outPath  = outputFile || inputFile.replace(/\.js$/, '.deobf.js');
const rawCode  = fs.readFileSync(inputFile, 'utf8');

// ── 1  Capture inner body ─────────────────────────────────────────────────────
let innerBody = null;
let paramName  = null;

const ctx1 = vm.createContext({ Function: new Proxy(Function, {
  apply(_t, _th, args) {
    if (args.length >= 2) { paramName = args[0]; innerBody = args[args.length - 1]; }
    return () => {};
  },
}) });
try { vm.runInContext(rawCode, ctx1, { timeout: 10_000 }); } catch (_) {}

if (!innerBody) { console.error('Could not capture inner body.'); process.exit(1); }
console.log(`[1] Inner body captured    ${innerBody.length} chars   param="${paramName}"`);

// ── 2  Identify decoder function ─────────────────────────────────────────────
//
//  Strategy A (high confidence): after the literal-constants array declaration,
//  the obfuscator always calls  SETUP_FN(DECODER_FN)  to lock the decoder's
//  .length property. We extract DECODER_FN from that first call.
//
//  Strategy B: Hex-call ranking filtered to declared function names; pick
//  2nd-most-called (the 1st is usually an internal helper that got re-used).
//
//  Strategy C: 2nd or 1st ranked by raw count.

// Collect all function declaration names + hex-call counts
const fnDeclNames = new Set();
const fnDeclRE    = /\bfunction\s+(\w+)\s*\(/g;
let fdm;
while ((fdm = fnDeclRE.exec(innerBody)) !== null) fnDeclNames.add(fdm[1]);

const hexCounts = {};
const hexCallRE = /\b([A-Za-z_$][A-Za-z0-9_$]*)\((0x[0-9a-fA-F]+|\d+)\)/g;
let hm;
while ((hm = hexCallRE.exec(innerBody)) !== null)
  if (fnDeclNames.has(hm[1])) hexCounts[hm[1]] = (hexCounts[hm[1]] || 0) + 1;

const ranked = Object.entries(hexCounts).sort(([, a], [, b]) => b - a);

// Strategy A – several sub-patterns to find SETUP_FN(DECODER_FN):
//   A1: const ARR=[...]; SETUP(DECODER);
//   A2: SETUP(X),SETUP(DECODER)   (comma-separated dual setup call)
//   A3: SETUP(X);SETUP(DECODER)   (semicolon-separated dual setup)
// A2/A3: same setup fn called multiple times – find the LAST argument
// (The last SETUP_FN(X) call's argument is the decoder)
const afterArrayM =
  innerBody.match(/\b(\w+)\(\w+\)[,;]\s*\1\((\w+)\)/) ||   // initial pair match → gives setup fn name
  innerBody.match(/\];\s*(\w+)\((\w+)\)\s*;/)  ||           // A1 fallback
  null;

let decoderFn = afterArrayM?.[2] ?? null;

// If we found a setup function, look for its calls in the INIT BLOCK only
// (first ~6000 chars where the setup happens, before module loading begins)
if (afterArrayM?.[1]) {
  const setupFnEsc = afterArrayM[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match: SETUP(X),SETUP(Y),SETUP(DECODER) – all in one expression
  // Prefer the multi-arg version: we want the last distinct arg in consecutive calls
  const multiSetupRE = new RegExp(
    `\\b${setupFnEsc}\\((\\w+)\\)(?:[,;]\\s*${setupFnEsc}\\(\\w+\\))*[,;]\\s*${setupFnEsc}\\((\\w+)\\)`, 'g'
  );
  let bestMatch = null;
  let mm;
  const initBlock = innerBody.slice(0, 8000); // only look in first 8KB
  while ((mm = multiSetupRE.exec(initBlock)) !== null) bestMatch = mm;
  if (bestMatch?.[2]) decoderFn = bestMatch[2];
}

// Validate: if the chosen decoder has very few hex calls, fall back to ranked list
if (!decoderFn || (hexCounts[decoderFn] || 0) < 15) {
  decoderFn = ranked[0]?.[0];
}

// Strategy B – 2nd-most-called declared function (1st is often an internal helper)
if (!decoderFn && ranked.length >= 2) decoderFn = ranked[1][0];
if (!decoderFn && ranked.length >= 1) decoderFn = ranked[0][0];

const rawDecoderCandidate = afterArrayM?.[1]; // the setup function, not raw decoder – just for logging
console.log(`[2] Setup fn               "${afterArrayM?.[1]}"`)
console.log(`    String decoder          "${decoderFn}"  (~${hexCounts[decoderFn]} hex calls)`);

// ── 3  Extract proxy-key mappings ────────────────────────────────────────────
const proxyRE  = /\(\{get"(\w+)"\(\)\{return window\},get"(\w+)"\(\)\{return require\},get"(\w+)"\(\)\{return module\}/;
const proxyM   = rawCode.match(proxyRE);
const windowKey = proxyM?.[1], requireKey = proxyM?.[2], moduleKey = proxyM?.[3];
console.log(`[3] Proxy keys             window="${windowKey}" require="${requireKey}" module="${moduleKey}"`);

// ── 4  Run inner body in sandbox to materialise decoded strings ───────────────
const decodedStrings = {};
const fakeModule = { exports: {}, id: inputFile, filename: inputFile, loaded: false };

const proxyArg = {};
if (windowKey)  proxyArg[windowKey]  = makeStub('window');
if (requireKey) proxyArg[requireKey] = requireStub;
if (moduleKey)  proxyArg[moduleKey]  = fakeModule;

const MAX_IDX = 4000;

// ── Detect literal array early (needed for runCode template) ─────────────────
const _litArrRE  = /\bconst\s+(\w+)\s*=\s*\[(?:0x[0-9a-f]+|"[^"]*"|-?\d+|!0x[01]|void 0x0|null)/i;
const litArrayName = innerBody.match(_litArrRE)?.[1];

// Decoder set – start with the primary decoder, then add secondaries conservatively:
// only add a secondary if it appears in the SETUP function call sequence
// (i.e., SMCX8_(secondary_decoder) appears in the init block).
const allDecoderFns = new Set([decoderFn]);

if (afterArrayM?.[1]) {
  const setupFnEsc = afterArrayM[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Find all args in the init block: SETUP(X),SETUP(Y),SETUP(Z) – all are decoders
  const initBlock = innerBody.slice(0, 8000);
  const setupArgRE = new RegExp(`\\b${setupFnEsc}\\((\\w+)\\)`, 'g');
  let sa;
  while ((sa = setupArgRE.exec(initBlock)) !== null) {
    const name = sa[1];
    // Add if it has significant hex calls (likely a real decoder, not a helper)
    if ((hexCounts[name] || 0) >= 15) allDecoderFns.add(name);
  }
}

const capturedLitArrays = {};   // fnName → array (or the global one)

// ── Pre-extract literal array by evaling just its declaration ─────────────────
if (litArrayName) {
  // Match: const NAME=[...]; (everything up to the closing ];)
  const litDeclRE = new RegExp(`(?:const|var|let)\\s+${litArrayName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`);
  const litDeclM  = innerBody.match(litDeclRE);
  if (litDeclM) {
    try {
      // The array may contain: hex, strings, void 0x0, !0x0, !0x1, null, booleans
      // These are all valid JS literals – eval is safe here (no code, just data)
      const evalCtx = vm.createContext({ void: undefined, undefined });
      capturedLitArrays[litArrayName] = vm.runInContext(litDeclM[1], evalCtx, { timeout: 5_000 });
    } catch (_) {}
  }
  if (!capturedLitArrays[litArrayName]) {
    // Fallback: find "const NAME=[" and grab until the matching "];"
    const start = innerBody.indexOf(`const ${litArrayName}=[`) !== -1
      ? innerBody.indexOf(`const ${litArrayName}=[`)
      : innerBody.indexOf(`const ${litArrayName} = [`);
    if (start !== -1) {
      // Find the matching ] by counting brackets
      let depth = 0, end = -1;
      for (let i = start; i < innerBody.length; i++) {
        if (innerBody[i] === '[') depth++;
        else if (innerBody[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
      }
      if (end !== -1) {
        const arrSrc = innerBody.slice(start + `const ${litArrayName}=`.length, end).trim()
          .replace(/^=?\s*/, '');
        try {
          capturedLitArrays[litArrayName] = vm.runInContext(arrSrc, vm.createContext({
            String, Number, Boolean, Array, Object, Math, JSON, parseInt, parseFloat,
            undefined, null: null
          }), { timeout: 5_000 });
        } catch (_) {}
      }
    }
  }
}

const runCtx = vm.createContext({
  __proxyArg:      proxyArg,
  __decodedStrings: decodedStrings,
  __capturedLitArrays: capturedLitArrays,
  require:  requireStub,
  module:   fakeModule,
  exports:  fakeModule.exports,
  Buffer, process, console,
  // Standard globals needed by the string-decoder chain
  String, Number, Boolean, Array, Object, Math, JSON, RegExp, Error, Date, Symbol,
  Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
  Float32Array, Float64Array, ArrayBuffer, DataView, Map, Set, WeakMap, WeakSet,
  Promise, Proxy, Reflect,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  setTimeout: () => {}, clearTimeout: () => {},
  setInterval: () => {}, clearInterval: () => {},
  globalThis,
});

const PARAM = paramName || '__P__';

// Build string-capture calls for all known decoders
const captureBlock = [...allDecoderFns].map(fn => `
  try {
    for (let __i = 0; __i < ${MAX_IDX}; __i++) {
      try {
        const __v = ${fn}(__i);
        if (__v !== undefined && __v !== null && typeof __v === 'string') {
          if (!__decodedStrings["${fn}"]) __decodedStrings["${fn}"] = {};
          __decodedStrings["${fn}"][__i] = __v;
        }
      } catch(_) {}
    }
  } catch(_) {}`
).join('\n');

// ── Build runCode ─────────────────────────────────────────────────────────────
// The inner body ends with a `return module.exports = {...}` which exits the
// IIFE – bypassing any code placed after it in the try block.
// Using `finally` guarantees the captureBlock always runs, even after a return.
const runCode = `
(function(${PARAM}) {
  try {
${innerBody}
  } catch(__initErr) {
    // init error is OK – decoder fns are function-hoisted
  } finally {
    // finally always runs even after return statements
    try { __capturedLitArrays["${litArrayName}"] = ${litArrayName}; } catch(_) {}
    ${captureBlock}
  }
})(__proxyArg);
`;

try {
  vm.runInContext(runCode, runCtx, { timeout: 30_000 });
} catch (err) {
  console.warn(`[4] Sandbox warning: ${err.message}`);
}

// Flatten decoded strings: decoderFn is the primary key (backwards-compat)
const allDecoded = {};   // fnName → { idx → string }
for (const [fn, map] of Object.entries(decodedStrings)) {
  if (typeof map === 'object') allDecoded[fn] = map;
}

const decodedCount = Object.values(allDecoded).reduce((s, m) => s + Object.keys(m).length, 0);
console.log(`[4] Decoded strings        ${decodedCount} entries across ${Object.keys(allDecoded).length} decoder(s)`);
for (const [fn, map] of Object.entries(allDecoded)) {
  const sample = Object.entries(map).slice(0, 4).map(([k, v]) => `${k}:"${String(v).slice(0, 30)}"`).join('  ');
  console.log(`    ${fn}: ${Object.keys(map).length} strings  sample: ${sample}`);
}

// ── 5  Report literal array ───────────────────────────────────────────────────
console.log(`[5] Literal array          "${litArrayName}"  (captured: ${!!capturedLitArrays[litArrayName]})`);

/** Replace all decoderFn(N) calls in `src` using the decoded-string maps. */
function applyDecoderReplacements(src) {
  let totalReplaced = 0;
  for (const [fn, strMap] of Object.entries(allDecoded)) {
    const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re  = new RegExp(`\\b${esc}\\((0x[0-9a-fA-F]+|\\d+)\\)`, 'g');
    let replaced = 0;
    src = src.replace(re, (match, idx) => {
      const num = idx.startsWith('0x') ? parseInt(idx, 16) : parseInt(idx, 10);
      if (strMap[num] !== undefined) { replaced++; return `"${escapeStr(strMap[num])}"` ; }
      return match;
    });
    totalReplaced += replaced;
  }
  return { src, totalReplaced };
}

// ── 6  First decoder-call pass (hex literals: I27f5m(0x144)) ────────────────
let result = innerBody;
let pass1 = applyDecoderReplacements(result);
result = pass1.src;
console.log(`[6] Decoder pass 1: replaced ${pass1.totalReplaced} calls`);

// ── 7  Resolve literal-array lookups ─────────────────────────────────────────
if (litArrayName && capturedLitArrays[litArrayName]) {
  const litArray = capturedLitArrays[litArrayName];
  const esc = litArrayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re  = new RegExp(`\\b${esc}\\[(0x[0-9a-fA-F]+|\\d+)\\]`, 'g');
  let replaced = 0;
  result = result.replace(re, (match, idx) => {
    const num = idx.startsWith('0x') ? parseInt(idx, 16) : parseInt(idx, 10);
    const val = litArray[num];
    if (val === undefined) return 'undefined';
    if (val === null)      return 'null';
    replaced++;
    return typeof val === 'string' ? `"${escapeStr(val)}"` : String(val);
  });
  console.log(`[7] Resolved ${replaced} literal-array lookups`);

  // ── 7b  Second decoder pass (decimal literals after array resolution: I27f5m(324)) ──
  let pass2 = applyDecoderReplacements(result);
  result = pass2.src;
  console.log(`[7b] Decoder pass 2: replaced ${pass2.totalReplaced} more calls`);
} else {
  console.log('[7] Literal array not in sandbox scope – skipped');
}

// ── 8  Beautify ───────────────────────────────────────────────────────────────
let beautified = result;
try {
  const jsb = require('js-beautify').js;
  beautified = jsb(result, { indent_size: 2, end_with_newline: true });
  console.log('[8] Beautified with js-beautify');
} catch (_) {
  console.warn('[8] js-beautify unavailable');
}

// ── 9  Write output ───────────────────────────────────────────────────────────
const header = [
  '/**',
  ` * Deobfuscated from : ${path.basename(inputFile)}`,
  ` * Generated         : ${new Date().toISOString()}`,
  ` *`,
  ` * ⚠  Variable/function names are permanently lost (random identifiers remain).`,
  ` *    All string literals and numeric constants have been resolved.`,
  ` *`,
  ` * Decoder fn   : ${decoderFn}  (${hexCounts[decoderFn]} hex calls)`,
  ` * Setup fn     : ${rawDecoderCandidate}`,
  ` * Literal array: ${litArrayName}`,
  ` * Strings decoded: ${decodedCount}  Decoders: ${[...allDecoderFns].join(', ')}`,
  ' */',
  '',
].join('\n');

fs.writeFileSync(outPath, header + beautified, 'utf8');
console.log(`\n✓ Written → ${outPath}`);
console.log(`  Input  : ${(rawCode.length     / 1024).toFixed(1)} KB`);
console.log(`  Output : ${(beautified.length  / 1024).toFixed(1)} KB`);
