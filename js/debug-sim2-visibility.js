// Helper script for diagnosing sim2 layout issues. Not part of production.
(function() {
  const sim2 = document.getElementById('sim2-container');
  if (!sim2) return;
  const info = {
    sim2Inline: sim2.style.display,
    sim2Computed: getComputedStyle(sim2).display,
    sim2Rect: sim2.getBoundingClientRect(),
    bodyStyle: getComputedStyle(document.body),
    htmlStyle: getComputedStyle(document.documentElement),
    bodyClass: document.body.className,
    sim2ParentId: sim2.parentElement?.id,
    sim2ParentClass: sim2.parentElement?.className,
  };
  console.log('DEBUG sim2 visibility:', info);
})();