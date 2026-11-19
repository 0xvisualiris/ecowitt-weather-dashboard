// The visitor's design, set on <html> before the page is drawn so the other one never flashes.
// A classic script on purpose: it runs while the head is parsed. Liquid Glass unless the visitor
// chose the original Himmel design on the Settings page (settings.js, DESIGN_KEY in glass.js).
try {
  document.documentElement.dataset.design = localStorage.getItem('wetterstation.design') === 'himmel' ? 'himmel' : 'glass';
} catch {
  document.documentElement.dataset.design = 'glass';
}
