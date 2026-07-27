const fs = require('fs');
const files = ['index.js', 'monitor.js'];
files.forEach(file => {
  let data = fs.readFileSync(file, 'utf8');
  const newFunc = `function escapeHtml(str) {
  return String(src)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}`;
  const regex = /function escapeHtml\(str\) \{[\s\S]*?\}/;
  data = data.replace(regex, newFunc);
  fs.writeFileSync(file, data);
});