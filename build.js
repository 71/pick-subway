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

await prepareData();

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
  const token = process.env["SUBWAY_API_TOKEN"];

  // Fetch all data.
  const [allStations, stationNames, elevators, lifts] = await Promise.all([
    async function () {
      // Source: https://data.seoul.go.kr/dataList/OA-121/S/1/datasetView.do
      const resp = await fetch(
        `http://openapi.seoul.go.kr:8088/${token}/json/SearchInfoBySubwayNameService/1/999//`,
      );
      const json = await resp.json();
      /** @type {{ STATION_NM: string, LINE_NUM: string }[]} */
      const rows = json.SearchInfoBySubwayNameService.row;

      return rows;
    }(),
    async function () {
      // Source: http://www.seoulmetro.co.kr/kr/board.do?menuIdx=551&bbsIdx=2208453
      const resp = await fetch("http://www.seoulmetro.co.kr/boardFileDown.do?file_idx=17209");
      const rows = await readXlsxFile(Buffer.from(await resp.arrayBuffer()));

      return rows;
    }(),
    async function () {
      // Source: https://data.seoul.go.kr/dataList/OA-21212/S/1/datasetView.do
      const resp = await fetch(
        `http://openapi.seoul.go.kr:8088/${token}/json/tbTraficElvtr/0/999/`,
      );
      const json = await resp.json();
      /** @type {{ SW_NM: string, NODE_WKT: string }[]} */
      const rows = json.tbTraficElvtr.row;

      return rows;
    }(),
    async function () {
      // Source: https://data.seoul.go.kr/dataList/OA-21211/S/1/datasetView.do
      const resp = await fetch(
        `http://openapi.seoul.go.kr:8088/${token}/json/tbTraficEntrcLft/0/999/`,
      );
      const json = await resp.json();
      /** @type {{ SW_NM: string, NODE_WKT: string }[]} */
      const rows = json.tbTraficEntrcLft.row;

      return rows;
    }(),
  ]);

  // Map station names to their translations, when available.
  const stationsToNames = Object.fromEntries(
    stationNames
      .slice(1)
      .map(([_id, _line, ko, _hanja, en, ch, jp]) => [ko, { ko, en, ch, jp }]),
  );

  // Map stations to their coordinates, when available.
  const stationsToCoords = Object.fromEntries(
    Object.entries(
      [...elevators, ...lifts]
        .map(x => ({
            station: x.SW_NM,
            coords: [.../(\d+\.\d+) (\d+\.\d+)/.exec(x.NODE_WKT)].slice(1).map(x => +x),
        }))
        .filter(x => x.station.length > 0)
        .reduce((acc, x) => ((acc[x.station] ??= []).push(x.coords), acc), {}),
    ).map(([k, v]) => [k, {
        lng: v.reduce((acc, y) => acc + y[0], 0) / v.length,
        lat: v.reduce((acc, y) => acc + y[1], 0) / v.length,
    }]),
  );

  // Normalize names.
  for (const obj of [stationsToCoords, stationsToNames]) {
    // Some names have additional data associated with them not present in `allStations`,
    // so we try to normalize it here.
    for (const key in obj) {
      const normalizedKey = /^\p{Script=Hangul}+/u.exec(key)?.[0] ?? key;

      if (!(normalizedKey in obj)) {
        obj[normalizedKey] = obj[key];
      }
    }
  }

  // Dedup stations.
  const dedupStations = Object.entries(
    allStations
      .reduce((acc, station) => ((acc[station.STATION_NM] ??= []).push(station.LINE_NUM), acc), {}),
  ).sort((a, b) => a[0].localeCompare(b[0]));

  // Write output.
  const outHandle = await fs.open("src/data.ts", "w");
  const outStream = outHandle.createWriteStream();

  try {
    outStream.write(`
export interface StationInfo {
  readonly id: string;
  readonly lines: readonly string[];

  readonly ko: string;
  readonly en?: string;
  readonly ch?: string;
  readonly jp?: string;

  readonly coords?: {
    readonly lng: number;
    readonly lat: number;
  };
}

export const stations: readonly StationInfo[] = Object.freeze([`);

    for (const [station, rawLines] of dedupStations) {
      const id = station;
      const lines = rawLines
        .map((line) => line.replace(/^0/, ""))
        .filter((line) => /^[1-8]호선$/.test(line))
        .sort();
      // ^ TODO: add support for more lines

      if (lines.length === 0) {
        continue;
      }

      const { ko = station, en, ch, jp } = stationsToNames[station] ?? {};
      const coords = stationsToCoords[station];

      outStream.write(`\n  ${JSON.stringify({ id, lines, ko, en, ch, jp, coords })},`);
    }

    outStream.write("\n]);\n");
  } finally {
    outStream.close();
  }
}
