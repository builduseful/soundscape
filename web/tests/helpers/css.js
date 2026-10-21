// Just enough of a CSS reader to answer "what does this rule declare?" for the
// app's own stylesheets: nested blocks by prelude, declarations by property.
// It assumes what those stylesheets hold — no braces or semicolons inside
// strings — and is not a general parser.

export function parseCss(source) {
    const css = source.replace(/\/\*[\s\S]*?\*\//gu, "");
    let index = 0;

    function block() {
        const node = { declarations: new Map(), rules: [] };
        let text = "";

        while (index < css.length) {
            const char = css[index++];

            if (char === "{") {
                const prelude = normalize(text);
                text = "";
                node.rules.push({ prelude, ...block() });
            } else if (char === "}") {
                addDeclaration(node, text);
                return node;
            } else if (char === ";") {
                addDeclaration(node, text);
                text = "";
            } else {
                text += char;
            }
        }

        addDeclaration(node, text);
        return node;
    }

    return block();
}

/** The CSS inside a component's `<style>` element. */
export function componentCss(source) {
    const match = /<style>([\s\S]*?)<\/style>/u.exec(source);
    if (!match) throw new Error("No <style> block found.");
    return match[1];
}

/**
 * The declarations of the rule reached by following `preludes` down from
 * `node`, each matched exactly once whitespace is collapsed. The first match at
 * each level wins.
 */
export function rule(node, ...preludes) {
    let current = node;

    for (const prelude of preludes) {
        const wanted = normalize(prelude);
        current = current.rules.find((child) => child.prelude === wanted);
        if (!current) throw new Error(`No rule "${preludes.join(" › ")}".`);
    }

    return current.declarations;
}

function addDeclaration(node, text) {
    const colon = text.indexOf(":");
    if (colon < 0) return;

    node.declarations.set(text.slice(0, colon).trim(), normalize(text.slice(colon + 1)));
}

function normalize(text) {
    return text.replace(/\s+/gu, " ").replace(/\s*,\s*/gu, ", ").trim();
}
