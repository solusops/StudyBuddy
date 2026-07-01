const katex = require('katex'); 
const tex = (src, displayMode) => katex.renderToString(src, { displayMode, throwOnError: false }); 
const renderMath = (text) => text.replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m, false)); 
let text = '**Experiment (A): Does the number of Heads ($h$) matter?**'; 
let result = renderMath(text); 
console.log('first *:', result.indexOf('*')); 
console.log('last *:', result.lastIndexOf('*')); 
console.log('length:', result.length);
console.log('replaced:', result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'));
