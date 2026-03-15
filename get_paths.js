const BASE = 'https://api.nexray.web.id';

async function fetchAndLog(path) {
    try {
        const res = await fetch(BASE + path);
        const text = await res.text();
        const matches = [...text.matchAll(/"(\/(?:ephoto|search|tools)\/[a-zA-Z0-9_-]+)"/g)];
        const endpoints = [...new Set(matches.map(m => m[1]))];
        console.log(`\n=== Endpoints for ${path} ===`);
        endpoints.forEach(e => console.log(e));
    } catch (e) {
        console.log(`Error fetching ${path}: ${e}`);
    }
}

async function run() {
    await fetchAndLog('/category/ephoto');
    await fetchAndLog('/category/search');
    await fetchAndLog('/category/tools');
}

run();
