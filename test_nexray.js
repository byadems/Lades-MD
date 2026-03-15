const BASE = "https://api.nexray.web.id";

const endpoints = [
  // Stalker
  "/stalker/instagram?username=instagram",
  "/stalker/twitter?username=elonmusk",
  
  // Editor
  "/editor/wasted?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/editor/wanted?url=https://i.imgur.com/Y3KqMfn.jpg",
  
  // Ephoto
  "/ephoto/anime?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/ghibli?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/chibi?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/cinematic?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/graffiti?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/pixel?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/comic?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/ephoto/mafia?url=https://i.imgur.com/Y3KqMfn.jpg",
  
  // Tools
  "/tools/screenshot2?url=https://google.com",
  "/tools/screenshot?url=https://google.com",
  "/tools/ocr?url=https://i.imgur.com/Y3KqMfn.jpg",
  "/tools/ocr?image=https://i.imgur.com/Y3KqMfn.jpg",
  "/tools/upscale?url=https://i.imgur.com/Y3KqMfn.jpg&resolusi=1",
  "/tools/upscale?image=https://i.imgur.com/Y3KqMfn.jpg&resolusi=1",
  
  // Maker
  "/maker/smeme?background=https://i.imgur.com/Y3KqMfn.jpg&text_atas=TOP&text_bawah=BOTTOM",
  "/maker/codesnap?code=const%20a%20%3D%201;",
  
  // Search
  "/search/google?q=cats",
  "/search/googleimage?q=cats",
  "/search/bingimage?q=cats",
  "/search/resepkoki?q=ayam",
  "/search/resep?kategori=ayam",
  "/search/resep?q=ayam",
  
  // Games
  "/games/asahotak",
  "/games/tebakkata",
  "/games/tebakkimia",
  
  // Fun
  "/fun/alay?text=hello",
  
  // Textpro
  "/textpro/dragonball?text=dragon",
  "/textpro/typography?text=neon",
  "/textpro/graffiti?text=graffiti",
  "/textpro/devil?text=devil",
  
  // Canvas
  "/canvas/musiccard?title=Song&artist=Artist&image=https://i.imgur.com/Y3KqMfn.jpg"
];

async function run() {
  const failed = [];
  for (const path of endpoints) {
    try {
      const res = await fetch(`${BASE}${path}`);
      
      const contentType = res.headers.get("content-type") || "";
      let d;
      let bodyText = "";
      
      try {
          if (contentType.includes("application/json")) {
              d = await res.json();
              bodyText = JSON.stringify(d);
          } else {
              const buf = await res.arrayBuffer();
              d = Buffer.from(buf);
              bodyText = `Buffer(${d.length} bytes)`;
          }
      } catch(e) { bodyText = "Error parsing response body"; }

      if (!res.ok) {
        let msg = `[${res.status}] - ${bodyText.substring(0, 100)}`;
        console.log(`❌ FAIL: ${path} => ${msg}`);
        failed.push(path);
      } else {
        // Basic detection if it succeeded but returned an inner status: false
        if (d && !Buffer.isBuffer(d) && typeof d === 'object') {
            if (d.status === false || d.message === 'Error' || d.creator !== 'Nexray') {
                console.log(`⚠️ WARN: ${path} => Returned 200 but data indicates failure or unexpected signature: ${bodyText.substring(0, 100)}`);
            } else {
                console.log(`✅ OK: ${path}`);
            }
        } else if (Buffer.isBuffer(d) || typeof d === 'string') {
            console.log(`✅ OK: ${path} (Buffer/String)`);
        } else {
            console.log(`✅ OK: ${path}`);
        }
      }
    } catch (e) {
      console.log(`💥 ERROR: ${path} => ${e.message}`);
      failed.push(path);
    }
    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }
  console.log(`\n\nTotal failed: ${failed.length}`);
}

run();
