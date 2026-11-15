/**
 * Demo shop — zero dependencies, on purpose.
 *
 * The whole point of this app is to have one small, believable flow
 * (cart → checkout → pay) that a browser can drive and that can break in a
 * way a screenshot would miss. The bug lives in cart.mjs at one commit.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenizeCard } from "./cart.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const orders = new Map();

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="icon" href="data:," />
<title>${title} · Northwind Supply</title>
<style>
  :root { --ink:#111; --muted:#6b7280; --line:#e5e7eb; --accent:#0f766e; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.5 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--ink); background:#fafaf9; }
  header { display:flex; justify-content:space-between; align-items:center; padding:18px 28px; border-bottom:1px solid var(--line); background:#fff; }
  header b { letter-spacing:-.02em; }
  main { max-width:880px; margin:0 auto; padding:40px 28px 80px; }
  h1 { font-size:30px; letter-spacing:-.03em; margin:0 0 6px; }
  p.sub { color:var(--muted); margin:0 0 28px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px; }
  .card h3 { margin:0 0 4px; font-size:17px; }
  .price { color:var(--muted); margin:0 0 14px; }
  button { font:inherit; border:0; border-radius:10px; padding:11px 18px; background:var(--accent); color:#fff; cursor:pointer; }
  button.secondary { background:#fff; color:var(--ink); border:1px solid var(--line); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  a { color:var(--accent); }
  label.field { display:block; margin:14px 0 4px; font-size:14px; color:var(--muted); }
  input[type=text] { width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; background:#fff; }
  .saved { display:flex; gap:10px; align-items:flex-start; padding:14px; border:1px solid var(--line); border-radius:12px; background:#fff; }
  .muted { color:var(--muted); font-size:14px; }
  .error { margin:18px 0 0; padding:14px 16px; border-radius:12px; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; }
  .ok { margin:18px 0 0; padding:14px 16px; border-radius:12px; background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0; }
  code { background:#f3f4f6; padding:2px 6px; border-radius:6px; font-size:13px; }
</style>
</head>
<body>
<header><b>Northwind Supply</b><span class="muted">demo shop</span></header>
<main>${body}</main>
</body>
</html>`;

const PRODUCTS = [
  { id: "kettle", name: "Studio Kettle", price: "$48.00", blurb: "1L, brushed steel" },
  { id: "mug", name: "Ridge Mug", price: "$18.00", blurb: "set of two" },
  { id: "beans", name: "Harbor Beans", price: "$22.00", blurb: "250g, whole" },
];

function home() {
  return page(
    "Shop",
    `<h1>Three good things</h1>
     <p class="sub">A tiny shop used to demonstrate verified browser flows.</p>
     <div class="grid">
      ${PRODUCTS.map(
        (p) => `<div class="card">
          <h3>${p.name}</h3>
          <p class="muted">${p.blurb}</p>
          <p class="price">${p.price}</p>
          <button data-add="${p.id}">Add to cart</button>
        </div>`,
      ).join("")}
     </div>
     <p style="margin-top:28px"><a href="/checkout" id="go-checkout">Go to checkout →</a></p>
     <script>
       const cart = [];
       document.querySelectorAll('[data-add]').forEach((b) =>
         b.addEventListener('click', () => {
           cart.push(b.dataset.add);
           b.textContent = 'Added';
           sessionStorage.setItem('cart', JSON.stringify(cart));
           setTimeout(() => (b.textContent = 'Add to cart'), 900);
         })
       );
     </script>`,
  );
}

function checkout() {
  return page(
    "Checkout",
    `<h1>Checkout</h1>
     <p class="sub">Saved card ending <b>4242</b>, or pay with a new card.</p>
     <form id="pay-form">
       <div class="saved">
         <input type="radio" name="method" id="saved" value="saved" checked />
         <label for="saved"><b>Use saved card</b> · Visa ···· 4242<br><span class="muted">Expires 04/29</span></label>
       </div>
       <div class="saved" style="margin-top:10px">
         <input type="radio" name="method" id="new" value="new" />
         <label for="new"><b>Pay with a new card</b></label>
       </div>
       <div id="new-fields" hidden>
         <label class="field" for="number">Card number</label>
         <input id="number" type="text" inputmode="numeric" placeholder="4242 4242 4242 4242" value="4242 4242 4242 4242" />
         <label class="field" for="exp">Expiry</label>
         <input id="exp" type="text" placeholder="04/29" value="04/29" />
       </div>
       <p style="margin-top:22px"><button type="submit" id="pay">Pay $48.00</button></p>
     </form>
     <div id="result" role="status" aria-live="polite"></div>
     <script>
       const form = document.getElementById('pay-form');
       const fields = document.getElementById('new-fields');
       const out = document.getElementById('result');
       form.addEventListener('change', () => {
         fields.hidden = document.getElementById('new').checked === false;
       });
       form.addEventListener('submit', async (e) => {
         e.preventDefault();
         out.innerHTML = '';
         const method = document.querySelector('input[name=method]:checked').value;
         const cardNumber = document.getElementById('number').value;
         const btn = document.getElementById('pay');
         btn.disabled = true; btn.textContent = 'Paying…';
         try {
           const res = await fetch('/api/pay', {
             method: 'POST',
             headers: { 'content-type': 'application/json' },
             body: JSON.stringify({ method, cart: ['kettle'], cardNumber: method === 'new' ? cardNumber : undefined }),
           });
           const data = await res.json().catch(() => ({}));
           if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
           out.innerHTML = '<div class="ok" id="confirmation">Payment confirmed. Order <b>' + data.orderId + '</b>.</div>';
         } catch (err) {
           out.innerHTML = '<div class="error" id="pay-error">Payment failed. ' + err.message + '</div>';
         } finally {
           btn.disabled = false; btn.textContent = 'Pay $48.00';
         }
       });
     </script>`,
  );
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/health") return json(res, 200, { ok: true });

  if (url.pathname === "/favicon.ico") {
    res.writeHead(204, { "cache-control": "public, max-age=86400" });
    return res.end();
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(home());
  }

  if (url.pathname === "/checkout") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(checkout());
  }

  if (url.pathname === "/api/pay" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { error: "Invalid JSON" });
    }

    try {
      const token = tokenizeCard({ method: body.method, savedCard: body.method === "saved", cardNumber: body.cardNumber });
      if (!token) return json(res, 500, { error: "Payment provider rejected the token" });
      const orderId = "NW-" + String(1042 + orders.size);
      orders.set(orderId, { token, cart: body.cart ?? [] });
      return json(res, 201, { orderId });
    } catch (err) {
      return json(res, 500, { error: err?.message ?? "Payment provider error" });
    }
  }

  res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
  res.end(page("Not found", `<h1>404</h1><p class="sub">Nothing here.</p><p><a href="/">Back to the shop</a></p>`));
});

server.listen(PORT, () => {
  console.log(`demo shop on http://localhost:${PORT}`);
});

// Keep the module import used in dev tooling.
void readFileSync;
void join;
void here;
