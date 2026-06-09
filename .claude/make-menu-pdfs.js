/* ============================================================
   da Cecot — branded menu PDF generator (placeholder content)
   Erika updates menus in Canva long-term; these PDFs keep the
   menu hub functional until her exports replace the files.
   Run:  node .claude/make-menu-pdfs.js
   Requires Chrome at the standard Windows install path.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'menus');
const TMP = path.join(__dirname, 'menu-tmp');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const css = `
  @page { size: letter; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; background: #F7F2E9; color: #4A2E22; padding: 56px 64px; }
  .head { text-align: center; border-bottom: 2px solid #B8612D; padding-bottom: 22px; margin-bottom: 30px; }
  .brand { font-size: 38px; font-style: italic; letter-spacing: 1px; }
  .brand small { display:block; font-style: normal; font-size: 11px; letter-spacing: 4px; text-transform: uppercase; color: #B8612D; margin-top: 6px; }
  h1 { font-size: 21px; letter-spacing: 5px; text-transform: uppercase; margin-top: 16px; color: #3F512E; }
  h2 { font-size: 15px; letter-spacing: 3px; text-transform: uppercase; color: #B8612D; margin: 26px 0 12px; border-bottom: 1px solid rgba(184,97,45,.35); padding-bottom: 6px; }
  .item { display: flex; justify-content: space-between; align-items: baseline; margin: 9px 0; }
  .item .n { font-size: 14.5px; font-weight: bold; }
  .item .p { font-size: 14px; color: #3F512E; white-space: nowrap; padding-left: 14px; }
  .d { font-size: 12px; color: #6b5747; margin-top: 1px; max-width: 520px; }
  .dots { flex: 1; border-bottom: 1px dotted rgba(74,46,34,.4); margin: 0 8px; transform: translateY(-3px); }
  .note { margin-top: 30px; text-align: center; font-size: 11px; color: #8a7666; font-style: italic; }
  .foot { margin-top: 18px; text-align: center; font-size: 11px; letter-spacing: 1px; color: #4A2E22; }
`;

function row(n, d, p) {
  return `<div class="item"><div><span class="n">${n}</span>${d ? `<div class="d">${d}</div>` : ''}</div><span class="dots"></span><span class="p">${p}</span></div>`;
}

function doc(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
  <div class="head"><div class="brand">da Cecot<small>food inc · italian comfort food</small></div><h1>${title}</h1></div>
  ${body}
  <p class="note">Our menus change with the seasons and our handmade production — ask our team for today's selection.</p>
  <p class="foot">Whyte Ave (82 Ave) &amp; 104 Street · Edmonton, AB · (825) 888-4218 · dacecotfood.com</p>
  </body></html>`;
}

const menus = {
  'lunch-menu': doc('Lunch Menu', `
    <h2>Pasta Bowls</h2>
    ${row('Caserecce al Ragù', 'Our signature hand-rolled caserecce with slow-simmered Ragù alla Bolognese', '$16')}
    ${row('Tagliatelle Plasé', 'Fresh egg tagliatelle with our signature Plasé pomodoro sauce', '$15')}
    ${row('Cacio e Pepe', 'Tomato Top 100 Edmonton — pecorino, cracked pepper, fresh spaghetti', '$16')}
    ${row('Gnocchi di Pomodoro Plasé', 'Pillowy hand-made gnocchi in Plasé tomato sauce', '$14')}
    <h2>Quick Lunch</h2>
    ${row('Lasagna of the Day', 'Baked fresh each morning — ask for today\’s style', '$15')}
    ${row('Cicchetti Plate', 'Italian small bites — a rotating selection from our kitchen', '$12')}
    ${row('Italian Salad', 'Seasonal greens, house dressing', '$8')}
    <h2>To Finish</h2>
    ${row('Tiramisu della Casa', 'House-made, the classic way', '$9')}
    ${row('Espresso · Moka', '', '$3.5')}
  `),
  'dinner-menu': doc('Dinner Menu', `
    <h2>Antipasti</h2>
    ${row('Cicchetti della Casa', 'Italian small bites, built for sharing', '$14')}
    ${row('Bruschetta Trio', 'Tomato &amp; basil · olive tapenade · seasonal', '$12')}
    <h2>Handmade Pasta</h2>
    ${row('Caserecce al Ragù Bolognese', 'Slow-simmered beef ragù, hand-rolled caserecce', '$19')}
    ${row('Cacio e Pepe', 'Tomato Top 100 Edmonton — pecorino, cracked pepper', '$18')}
    ${row('Tagliatelle Bosco Romagno', 'Forest mushroom sauce from our Friuli roots', '$20')}
    ${row('Tortelloni Verdi', 'Spinach parcels, fine cheeses, velvety mushroom sauce', '$21')}
    <h2>Ravioli Atelier <span style="font-size:10px; letter-spacing:1px;">· Friday &amp; Saturday evenings</span></h2>
    ${row('This Week\’s Atelier Ravioli', 'Limited handmade ravioli inspired by regional Italian traditions — ask your server', 'Market')}
    <h2>Secondi</h2>
    ${row('Brasato al Barolo', 'Slow-braised beef in Barolo wine — limited availability', '$28')}
    ${row('Chicken Arrosto', 'Italian roast chicken, seasonal vegetables', '$24')}
    <h2>Dolci</h2>
    ${row('Tiramisu della Casa', '', '$9')}
    ${row('Affogato', 'Gelato drowned in fresh espresso', '$8')}
  `),
  'drinks-dessert-menu': doc('Drinks &amp; Dessert', `
    <h2>Caffè</h2>
    ${row('Espresso', '', '$3.5')}
    ${row('Moka Coffee Experience', 'Traditional stovetop moka, served the family way', '$5')}
    ${row('Cappuccino · Latte', '', '$4.5')}
    ${row('Affogato', 'Gelato drowned in fresh espresso', '$8')}
    <h2>Italian Drinks</h2>
    ${row('Italian Sodas', 'Aranciata · Limonata · Chinotto', '$4')}
    ${row('San Pellegrino', 'Sparkling water 500 mL', '$4')}
    <h2>Dolci</h2>
    ${row('Tiramisu della Casa', 'House-made, the classic way', '$9')}
    ${row('Gelato', 'Rotating flavours — ask our team', '$6')}
    ${row('Seasonal Dessert', 'From Erika\’s notebook — changes with the season', 'Market')}
  `),
  'kids-menu': doc('Kids Menu', `
    <h2>For Younger Guests</h2>
    ${row('Pasta al Burro', 'Fresh pasta with butter and parmesan — simple and comforting', '$8')}
    ${row('Pasta al Pomodoro', 'Fresh pasta with our gentle Plasé tomato sauce', '$9')}
    ${row('Mini Gnocchi', 'Soft potato gnocchi with butter or tomato sauce', '$9')}
    ${row('Kids Ravioli', 'Three cheese ravioli, mild and melty', '$10')}
    <h2>To Drink</h2>
    ${row('Milk · Juice', '', '$3')}
    ${row('Italian Soda', '', '$4')}
    <h2>Sweet Finish</h2>
    ${row('Scoop of Gelato', '', '$4')}
  `),
  'gluten-free-menu': doc('Gluten-Free Menu', `
    <h2>Prepared With Care</h2>
    ${row('Gluten-Free Pasta del Giorno', 'Daily gluten-free pasta with your choice of house sauce', '$18')}
    ${row('GF Pasta al Ragù', 'Slow-simmered Ragù alla Bolognese', '$19')}
    ${row('GF Pasta Plasé', 'Our signature pomodoro', '$17')}
    ${row('Seasonal GF Ravioli', 'Made in small batches — ask about this week\’s filling', 'Market')}
    <h2>Sides &amp; Finishes</h2>
    ${row('Italian Salad', 'Seasonal greens, house dressing', '$8')}
    ${row('Gelato', 'Most flavours gluten-free — ask our team', '$6')}
    <h2>Please Note</h2>
    <p class="d" style="max-width:none; font-size:12.5px; margin-top:8px;">Our kitchen handles wheat flour daily. We prepare gluten-free dishes with care and separate equipment wherever possible, but cannot guarantee a celiac-safe environment. Please tell our team about any allergy when ordering.</p>
  `)
};

for (const [name, html] of Object.entries(menus)) {
  const htmlPath = path.join(TMP, `${name}.html`);
  const pdfPath = path.join(OUT, `${name}.pdf`);
  fs.writeFileSync(htmlPath, html);
  execSync(`"${CHROME}" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath.replace(/\\/g, '/')}"`, { stdio: 'pipe' });
  console.log('PDF:', path.relative(ROOT, pdfPath));
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log('Done. Replace any file in /menus with a Canva export of the same name — no code changes needed.');
