// Små DOM-hjälpare för rendering med template literals.

export function el(html) {
  const mall = document.createElement('template');
  mall.innerHTML = html.trim();
  return mall.content.firstElementChild;
}

export function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function toast(text) {
  const t = el(`<div class="toast">${esc(text)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 2500);
}
