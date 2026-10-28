import katex from 'katex';
import 'katex/dist/katex.min.css';
import './math.css';

function placeholder(token, block) {
    const tag = block ? 'div' : 'span';
    return `<${tag} data-scip-math="${encodeURIComponent(token.text)}" data-display="${token.display}"></${tag}>`;
}

// Tokenize math before Markdown escapes backslashes or interprets underscores/pipes.
function extensions() {
    return [{
        name:'displayMath', level:'block',
        start:src => src.match(/(?:^|\n)[ \t]*(?:\$\$|\\\[)/)?.index,
        tokenizer(src) {
            const match = /^ {0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)?/.exec(src);
            if (match) return {type:'displayMath',raw:match[0],text:match[1] ?? match[2],display:true};
        },
        renderer:token => placeholder(token, true)
    },{
        name:'inlineMath', level:'inline',
        start:src => src.match(/\$|\\[([]/)?.index,
        tokenizer(src) {
            for (const [pattern, display] of [[/^\$\$([\s\S]+?)\$\$/,true],
                [/^\\\[([\s\S]+?)\\\]/,true],[/^\\\(([\s\S]+?)\\\)/,false]]) {
                const match = pattern.exec(src);
                if (match) return {type:'inlineMath',raw:match[0],text:match[1],display};
            }
            const match = /^\$(?!\s|\$)((?:\\.|[^$\n\\])+?)\$(?!\d)/.exec(src);
            if (match && !/\s$/.test(match[1])) return {type:'inlineMath',raw:match[0],text:match[1],display:false};
        },
        renderer:token => placeholder(token, false)
    }];
}

let parser;
export function render(element, raw) {
    if (!window.marked || !window.DOMPurify) { element.textContent = raw; return; }
    parser ||= new window.marked.Marked({extensions:extensions()});
    element.innerHTML = window.DOMPurify.sanitize(parser.parse(raw), {USE_PROFILES:{html:true}});
    for (const math of element.querySelectorAll('[data-scip-math]')) {
        let tex = math.dataset.scipMath;
        try {
            tex = decodeURIComponent(tex);
            katex.render(tex, math, {displayMode:math.dataset.display === 'true',
                trust:false,throwOnError:false,strict:'ignore',maxExpand:1000,maxSize:20,
                output:'htmlAndMathml',macros:{}});
        } catch {
            math.textContent = tex;
        }
        math.removeAttribute('data-scip-math');
        math.removeAttribute('data-display');
    }
}
window.ScipOJMarkdown = {render};
