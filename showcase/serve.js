// Tiny static server for the FX showcase. Run: bun showcase/serve.js
const dir = import.meta.dir;
const PORT = 5599;

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(dir + path);
    return new Response(file, {
      headers: { "Cache-Control": "no-store" },
    });
  },
});

console.log(`Cannoli FX showcase → http://localhost:${PORT}`);
