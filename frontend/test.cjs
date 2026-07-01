const katex = require('katex'); 
const tex = (src, displayMode) => katex.renderToString(src, { displayMode, throwOnError: false }); 
const renderMath = (text) => text.replace(/\$([^$\n]+?)\$/g, (_, m) => tex(m, false)); 
let text = '**Experiment (B): Does the size of the Key ($d_k$) matter?**'; 
let result = renderMath(text); 
console.log('Includes *: ', result.includes('*')); 
console.log('Includes newline: ', result.includes('\n')); 
console.log('Replaced: ', result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'));
