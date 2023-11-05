import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import { solidPlugin } from "esbuild-plugin-solid";
import readXlsxFile from "read-excel-file/node";

/** @type {boolean} */
const dev = process.argv.includes("--dev");

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: ["src/index.ts"],
  format: "esm",
  bundle: true,
  outdir: "dist",
  plugins: [
    solidPlugin(),
  ],

  minify: !dev,
  sourcemap: dev ? "linked" : false,

  define: {
    DEV: `${dev}`,
  },
  publicPath: "/",
};

prepareData();

if (dev) {
  const context = await esbuild.context(config);

  await context.watch();
  await context.serve({
    port: 1234,
    servedir: "dist",
  });
} else {
  await esbuild.build(config);
}

async function prepareData() {
  // Source: http://www.seoulmetro.co.kr/kr/board.do?menuIdx=551&bbsIdx=2208453
  const resp = await fetch("http://www.seoulmetro.co.kr/boardFileDown.do?file_idx=17209");
  const rows = await readXlsxFile(Buffer.from(await resp.arrayBuffer()));

  const outHandle = await fs.open("src/data.ts", "w");
  const outStream = outHandle.createWriteStream();

  try {
    outStream.write(`
export interface StationInfo {
  readonly id: string;
  readonly line: string;

  readonly ko: string;
  readonly en: string;
  readonly ch: string;
  readonly jp: string;
}

export const stations: readonly StationInfo[] = Object.freeze([`);

    for (const [_id, line, ko, _hanja, en, ch, jp] of rows.slice(1)) {
      const id = /^\p{Script=Hangul}+/u.exec(ko)[0];

      outStream.write(`\n  ${JSON.stringify({ id, line, ko, en, ch, jp })},`);
    }

    outStream.write("\n]);\n");
  } finally {
    outStream.close();
  }
}
