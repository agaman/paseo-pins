import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const deps = path.join(here, "node_modules");
const output = await mkdtemp(path.join(tmpdir(), "pins-listing-"));
let browser;
let server;
try {
  await build({
    entryPoints: [path.join(here, "preview.jsx")],
    outfile: path.join(output, "preview.js"),
    bundle: true,
    jsx: "automatic",
    nodePaths: [deps, path.join(root, "node_modules")],
    alias: {
      react: path.join(deps, "react"),
      "react-dom": path.join(deps, "react-dom"),
      "react-native": path.join(deps, "react-native-web"),
    },
    plugins: [
      {
        name: "sample-host",
        setup(b) {
          b.onResolve({ filter: /^@getpaseo\/plugin(?:\/client(?:\/ui)?)?$/ }, () => ({
            path: path.join(here, "fixture.jsx"),
          }));
        },
      },
    ],
  });
  const js = await readFile(path.join(output, "preview.js"));
  const icon = await readFile(path.join(root, "assets/icon.svg"));
  const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pins listing preview</title><style>body{margin:0}*{box-sizing:border-box}</style><div id="app"></div><script src="/preview.js"></script></html>';
  server = createServer((req, res) => {
    const script = req.url === "/preview.js";
    res.setHeader("Content-Type", script ? "text/javascript" : "text/html");
    res.end(script ? js : html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.PINS_CHROMIUM_PATH || undefined,
    args: process.env.PINS_CAPTURE_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
  });
  for (const [name, query, width, touch] of [
    ["menu-light", "", 360, false],
    ["menu-dark", "?dark", 360, false],
    ["menu-compact", "?compact", 390, true],
    ["chat-summary", "?chat", 700, false],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 2,
      hasTouch: touch,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(address + query);
    await page.getByText("The new onboarding flow is ready to review.", { exact: true }).waitFor();
    await page.getByText("Keyboard and screen-reader checks are ready.", { exact: true }).waitFor();
    if (name !== "chat-summary") {
      await page.getByText("Repo", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Pins settings", exact: true }).count(),
        1,
      );
    }
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    await page.locator("main").screenshot({ path: path.join(root, "assets", `${name}.png`) });
    assert.deepEqual(errors, []);
    console.log(`Captured ${name}`);
    await page.close();
  }
  await captureMenuGallery(browser);
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<style>body{margin:0;background:transparent}svg{display:block;width:256px;height:256px}</style>${icon}`,
  );
  await page.screenshot({ path: path.join(root, "assets/icon.png"), omitBackground: true });
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}

async function captureMenuGallery(browser) {
  const figures = await Promise.all(
    ["light", "dark"].map(async (theme) => {
      const png = await readFile(path.join(root, "assets", `menu-${theme}.png`));
      const label = theme === "light" ? "Light menu" : "Dark menu";
      return `<figure class="${theme}"><img src="data:image/png;base64,${png.toString("base64")}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
    }),
  );
  const page = await browser.newPage({
    viewport: { width: 740, height: 1000 },
    deviceScaleFactor: 2,
  });
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8">
    <style>
      body{margin:0;background:transparent;font:14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{display:flex;gap:20px;width:740px;align-items:flex-start}
      figure{margin:0;width:360px}
      .light{background:#fff;color:#71717a}.dark{background:#18181b;color:#a1a1aa}
      img{display:block;width:100%;height:auto}
      figcaption{text-align:center;padding:0 0 12px}
    </style><main>${figures.join("")}</main></html>`);
  await page.locator("img").evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  await page.locator("main").screenshot({
    path: path.join(root, "assets/menu-gallery.png"),
    omitBackground: true,
  });
  await page.close();
  console.log("Captured menu-gallery");
}
