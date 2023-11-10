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
  target: "chrome110",
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
  // Fetch all data.
  const [allStations, stationNames] = await Promise.all([
    async function () {
      const resp = await fetch(
        "https://smss.seoulmetro.co.kr/api/1000.do?userPhone=010-0000-0000&osType=A&osVer=1&appVer=1&apdbVer=1&versionName=1&regId=0&model=A&market=G",
        { method: "POST" },
      );
      const json = await resp.json();
      const stationsResp = await fetch(json.stationVerVO.downUrl);
      const csv = await stationsResp.text();

      return csv.split("\r\n")
        .filter((line) => line.length > 0)
        .map((line) => line.split(","))
        .map((
          [
            node,
            stationName,
            prevNode,
            nextNode,
            ,
            ,
            stationCode,
            lineCode,
            stationCodeEx,
            lat,
            lng,
            ,
            ,
            areaCode,
            downDoor,
            ,
            stationNameEn,
          ],
        ) => (
          {
            node: +node,
            stationName,
            stationNameEn,
            areaCode,
            lineCode: lineCode.split("◆"),
            prevNode: prevNode.split("◆").map((x) => +x),
            nextNode: nextNode.split("◆").map((x) => +x),
            stationCode: stationCode.split("◆"),
            stationCodeEx: stationCodeEx.split("◆"),
            lat: lat.split("◆").map((x) => +x),
            lng: lng.split("◆").map((x) => +x),
            downDoor: downDoor.split("◆"),
          }
        ));
    }(),
    async function () {
      // Source: http://www.seoulmetro.co.kr/kr/board.do?menuIdx=551&bbsIdx=2208453
      const resp = await fetch(
        "http://www.seoulmetro.co.kr/boardFileDown.do?file_idx=17209",
      );
      const rows = await readXlsxFile(Buffer.from(await resp.arrayBuffer()));

      return rows;
    }(),
  ]);

  // Map station names to their translations, when available.
  /** @type {Record<string, { ko: string, en: string, zh: string, ja: string }>} */
  const stationsToNames = Object.fromEntries(
    stationNames
      .slice(1)
      .map(([_id, _line, ko, _hanja, en, zh, ja]) => [ko, { ko, en, zh, ja }]),
  );

  // Normalize names.
  //
  // Some names have additional data associated with them not present in `allStations`,
  // so we try to normalize it here.
  for (const key in stationsToNames) {
    const normalizedKey = /^\p{Script=Hangul}+/u.exec(key)?.[0] ?? key;

    if (!(normalizedKey in stationsToNames)) {
      stationsToNames[normalizedKey] = stationsToNames[key];
    }
  }

  const seoulStations = allStations.filter((x) => x.areaCode === "CA");
  const seoulStationsByNode = Object.fromEntries(
    seoulStations.map((station) => [station.node, station.stationName]),
  );

  // Filter out data outside of lines 1-9, the only ones which expose the data we need.
  //
  // Line 9 doesn't expose the data we need, but we keep it for consistency.
  const supportedLines = [..."123456789"];
  const supportedLinesMap = Object.fromEntries(
    supportedLines.map((line) => [line, true]),
  );

  const finalStations = seoulStations
    .flatMap((station) => {
      // Find full station name and translations.
      const id = station.stationName;
      const ko = stationsToNames[id]?.ko ?? station.stationName;
      const en = stationsToNames[id]?.en ?? station.stationNameEn;
      const zh = stationsToNames[id]?.zh ?? en;
      const ja = stationsToNames[id]?.ja ?? en;

      // Compute average of all positions.
      const lat = station.lat.reduce((acc, v) => acc + v) / station.lat.length;
      const lng = station.lng.reduce((acc, v) => acc + v) / station.lng.length;

      // Merge line-dependent values into single objects, filtering out lines that are not
      // supported.

      /** @type {Record<number, { prevStation?: string, nextStation?: string }>} */
      const lines = {};

      for (let i = 0; i < station.lineCode.length; i++) {
        const lineCode = station.lineCode[i];

        if (!(lineCode in supportedLinesMap)) {
          continue;
        }

        const prevNode = station.prevNode[i];
        const nextNode = station.nextNode[i];
        const prevStation = prevNode === -1
          ? undefined
          : seoulStationsByNode[prevNode];
        const nextStation = nextNode === -1
          ? undefined
          : seoulStationsByNode[nextNode];

        lines[+lineCode] = { prevStation, nextStation };
      }

      if (Object.keys(lines).length === 0) {
        return [];
      }

      return {
        id,
        ko,
        en,
        zh,
        ja,

        lat,
        lng,

        lines,
      };
    });

  // Write output.
  const outHandle = await fs.open("src/data.ts", "w");
  const outStream = outHandle.createWriteStream();

  outStream.write(`\
export const supportedLines = ${
    JSON.stringify(supportedLinesMap, undefined, 2)
  } as const;

export type SupportedLine = keyof typeof supportedLines;
export type StationId = string;

export interface StationInfo {
  readonly id: StationId;

  readonly lng: number;
  readonly lat: number;

  readonly ko: string;
  readonly en: string;
  readonly zh: string;
  readonly ja: string;

  readonly lines: {
    [Line in SupportedLine]?: {
      readonly prevStation?: StationId;
      readonly nextStation?: StationId;
    };
  };
}

export const stations: readonly StationInfo[] = Object.freeze([`);

  for (const station of finalStations) {
    outStream.write(`\n  ${JSON.stringify(station)},`);
  }

  outStream.write(`
]);

export const stationsById: {
  readonly [stationId: StationId]: StationInfo;
} = Object.freeze(
  Object.fromEntries(
    stations.map((station) => [station.id, station]),
  ),
);
`);
  outStream.close();
}
