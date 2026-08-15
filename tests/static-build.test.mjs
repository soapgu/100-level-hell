import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds a GitHub Pages-ready static entry", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>是男人就下100层｜Web 像素复刻<\/title>/);
  assert.match(html, /https:\/\/soapgu\.github\.io\/100-level-hell\/og\.png/);
  assert.match(html, /\/100-level-hell\/assets\/[^"']+\.js/);
  const script = html.match(/src="\/100-level-hell\/(assets\/[^"']+\.js)"/);
  assert.ok(script);
  await access(new URL(`../dist/${script[1]}`, import.meta.url));
});
