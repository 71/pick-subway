import { Accessor, ErrorBoundary, For, Match, Resource, Show, Switch, createContext, createEffect, createMemo, createResource, createSignal, onCleanup, useContext } from "solid-js";
import { StationInfo, SupportedLine, stations, stationsById } from "./data";
import "./App.css";

interface Language {
  readonly id: "en" | "ko";
  readonly display: string;
  readonly congestionLabels: readonly [string, string, string, string];

  formatSeconds(secs: number): string;
}

interface Train {
  readonly eta: number;
  readonly etaMessage: string;
  readonly line: string;
  readonly lineName: string;
  readonly train: string;
  readonly destination?: string;
  readonly nextStation?: string;
}

const languages: readonly Language[] = [
  {
    id: "ko",
    display: "한국어",
    congestionLabels: ["여유", "보통", "주의", "혼잡"],
    formatSeconds: (secs) => `${secs}초`,
  },
  {
    id: "en",
    display: "English",
    congestionLabels: ["Comfortable", "Average", "Almost packed", "Packed"],
    formatSeconds: (secs) => `${secs}s`,
  },
];
const languagesById = Object.fromEntries(
  languages.map((l) => [l.id, l]),
) as Record<Language["id"], Language>;

const lineColors = {
  1: "#263F93",
  2: "#41B353",
  3: "#EF6C1D",
  4: "#2FA0DB",
  5: "#883FDB",
  6: "#B44F19",
  7: "#697121",
  8: "#E31F6D",
  9: "#D1A43C",
};

function useNow() {
  const [now, setNow] = createSignal(new Date());
  const interval = setInterval(() => setNow(new Date()), 1e3);

  onCleanup(() => clearInterval(interval));

  return now;
}

async function fetchUpcomingTrains(station: StationInfo) {
  const resp = await fetch(`https://fetch-subway.gsq.workers.dev/upcoming/${station.id}`);
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  const json: readonly Train[] = await resp.json();

  return json;
}

async function fetchCongestion({ language, line, train }: { language: Language, line: string, train: string }) {
  const resp = await fetch(`https://fetch-subway.gsq.workers.dev/congestion/${line}/${train}`);
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  const json: readonly number[] = await resp.json();

  return json
    .map((congestionId, i) => ({ car: i + 1, value: congestionId, label: language.congestionLabels[congestionId] }));
}

function errorHandler<T>(resource: Resource<T>) {
  const [resetError, setResetError] = createSignal<() => void>();

  createEffect(() => {
    if (resource.error == null && resetError() !== undefined) {
      resetError()!();
    }
  });

  return (e: unknown, resetError: () => void) => {
    setResetError(() => resetError);

    return (<span class="error">{`${(e as Error | undefined)?.message ?? e}`}</span>);
  };
}

function Train(props: { line: string, lineName: string, train: string, eta: number, etaMessage: string }) {
  const language = useContext(LanguageContext)!;
  const [expanded, setExpanded] = createSignal(false);
  const [congestion] = createResource(
    (() => ({ expanded: expanded() })),
    async ({ expanded }) => expanded ? await fetchCongestion({ language: language(), line: props.line, train: props.train }) : [],
    { initialValue: [] },
  );
  const now = useNow();
  const eta = createMemo(() => new Date(props.eta).valueOf() + new Date().getTimezoneOffset() * 60e3);

  return (
    <div class="train" data-train-id={props.train}>
      <div class="toggle" role="button" onClick={() => setExpanded((e) => !e)}>
        {expanded() ? "▼ " : "► "}
        {language().formatSeconds((now().valueOf() - eta()) / 1e3 | 0)}
      </div>

      <ErrorBoundary fallback={errorHandler(congestion)}>
        <div class="cars">
          <For each={congestion()}>
            {({ car, value, label }, index) => (
              <div class="car">
                <div class={`icon v${value}`}>
                  <div class="car-number">{car}</div>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
                    <Switch>
                      <Match when={index() == 0}>
                        <path d="M20 0 L180 0 Q200 0, 200 20 L200 90 Q200 100, 190 100 L10 100 Q0 100, 0 90 L0 80 Q10 0, 60 0" />
                      </Match>

                      <Match when={index() == congestion().length - 1}>
                        <path d="M20 0 L140 0 Q190 0, 200 80 L200 90 Q200 100, 190 100 L10 100 Q0 100, 0 90 L0 20 Q0 0, 20 0" />
                      </Match>

                      <Match when={true}>
                        <path d="M20 0 L180 0 Q200 0, 200 20 L200 90 Q200 100, 190 100 L10 100 Q0 100, 0 90 L0 20 Q0 0, 20 0" />
                      </Match>
                    </Switch>
                  </svg>
                </div>
                <span>{label}</span>
              </div>
            )}
          </For>
        </div>
      </ErrorBoundary>
    </div>
  );
}

function TrainsByDirection(props: { station: StationInfo, trains: readonly Train[] }) {
  const language = useContext(LanguageContext)!;
  const setCurrentStation = useContext(SetCurrentStationContext)!;

  const sortedGroupedTrains = createMemo(() => {
    const groupedTrains: Record<string, Train[]> = {};

    for (const train of props.trains) {
      if (/^[1-8]/.test(train.line)) {
        // Skip trains outside of line 1-8 since there is no congestion data for them.
        (groupedTrains[train.lineName] ??= []).push(train);
      }
    }

    const sortedGroups = Object.values(groupedTrains).sort((a, b) => {
      const a0 = a[0];
      const b0 = b[0];

      if (a0.line !== b0.line) {
        return a0.line.localeCompare(b0.line);
      }
      if (a0.lineName !== b0.lineName) {
        return a0.lineName.localeCompare(b0.lineName);
      }
      return a0.eta - b0.eta;
    });

    for (const group of sortedGroups) {
      group.sort((a, b) => a.eta - b.eta);
    }

    return sortedGroups;
  });

  const previousStation = createMemo(() => {
    const station = stationsById[props.station.id];

    return (lineNb: SupportedLine, nextStation: string) => {
      const line = station.lines[lineNb];

      return line?.nextStation === nextStation ? line.prevStation
           : line?.prevStation === nextStation ? line.nextStation
           : undefined;
    };
  });

  const stationName = (stationId: string) => stationsById[stationId]?.[language().id] ?? stationId;

  return (
    <div class="trains">
      <For each={sortedGroupedTrains()}>
        {(trains) => (
          <div class="group" style={`--line-accent: ${lineColors[trains[0].line as SupportedLine]}`}>
            <h2>
              <span class="line">{trains[0].line}</span>

              <Show when={trains[0].destination !== undefined} fallback={trains[0].lineName}>
                <Show when={previousStation()(trains[0].line as SupportedLine, trains[0].nextStation!) !== undefined}>
                  <span class="previous" onClick={
                    [setCurrentStation, stationsById[previousStation()(trains[0].line as SupportedLine, trains[0].nextStation!)!]]
                  }>
                    {stationName(previousStation()(trains[0].line as SupportedLine, trains[0].nextStation!)!)}
                  </span>
                  <span class="sep">›</span>
                </Show>
                <span class="current">{props.station[language().id]}</span>
                <span class="sep">›</span>
                <span class="next" onClick={[setCurrentStation, stationsById[trains[0].nextStation!]]}>
                  {stationName(trains[0].nextStation!)}
                </span>
                <Show when={trains[0].destination !== trains[0].nextStation}>
                  <span class="sep">⋯</span>
                  <span class="last">{stationName(trains[0].destination!)}</span>
                </Show>
              </Show>
            </h2>

            <For each={trains}>
              {(train) => <Train {...train} />}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

function Station(props: { station: StationInfo }) {
  const [trains, { refetch }] = createResource(() => props.station, fetchUpcomingTrains, { initialValue: [] });
  const interval = setInterval(() => refetch(), 30_000);

  onCleanup(() => clearInterval(interval));

  return (
    <div class="station">
      <ErrorBoundary fallback={errorHandler(trains)}>
        <TrainsByDirection station={props.station} trains={trains()} />
      </ErrorBoundary>
    </div>
  );
}

const defaultLanguage = (savedId: string): Language => {
  const choices = [savedId, ...navigator.languages];
  for (const lang of choices) {
    if (lang in languagesById) {
      return languagesById[lang as Language["id"]];
    }
  }
  return languagesById["en"];
};

const LanguageContext = createContext<Accessor<Language>>();
const SetCurrentStationContext = createContext<(station: StationInfo) => void>();

function LanguagePicker(props: { language: Language, setLanguage(value: Language): void }) {
  return (
    <div class="language-picker">
      <For each={languages}>
        {(language) => <>
          <input type="radio" name="language" id={`lang-${language.id}`}
                 value={language.id} checked={props.language.id === language.id}
                 onInput={() => props.setLanguage(language)} />
          <label for={`lang-${language.id}`}>{language.display}</label>
        </>}
      </For>
    </div>
  );
}

function StationPicker(props: { searchInput: string, setSearchInput(value: string): void }) {
  const language = useContext(LanguageContext)!;
  const [coords] = createResource(() => new Promise<GeolocationCoordinates | undefined>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition((geolocation) => resolve(geolocation.coords), reject, {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 20_000,
    });
  }));
  const sortedStations = createMemo(() => {
    const prop = language().id;
    const loadedCoords = coords();

    if (loadedCoords === undefined) {
      return stations;
    }

    const { latitude, longitude } = loadedCoords;
    const distanceToCurrentLocation = (coords: { lat: number, lng: number }) => (
      Math.sqrt(Math.pow(latitude - coords.lat, 2) + Math.pow(longitude - coords.lng, 2))
    );
    const sortedStations = [...stations].filter((station) => station[prop] !== undefined);

    sortedStations.sort((a, b) => {
      const aDistance = distanceToCurrentLocation(a);
      const bDistance = distanceToCurrentLocation(b);
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }
      return a[prop]!.localeCompare(b[prop]!);
    });

    return sortedStations;
  });

  return (
    <div class="section-picker">
      <datalist id="stations">
        <For each={sortedStations()}>
          {(station) => <option value={station[language().id]} />}
        </For>
      </datalist>

      <input name="station" list="stations" value={props.searchInput}
             onInput={(e) => props.setSearchInput(e.target.value)} />
    </div>
  );
}

export function App() {
  const SEARCH_KEY = "search";
  const LANGUAGE_KEY = "lang";

  // [...new Set(stations.flatMap(x => [...(x.ko + x.en + x.jp + x.ch)]))].sort().join("")
  const FORBIDDEN_CHARACTERS = /[^\p{L}0-9()&.·'‘’•∙・ -]/ug;
  const HASH_RE = /^\/(en|ko)\/([\p{L}0-9()&.·'‘’•∙・ -]+)$/u;

  const hashData = HASH_RE.exec(location.hash);

  if (hashData === null) {
    location.hash = "";
  }

  let initialLanguage = hashData?.[1] ?? localStorage.getItem(LANGUAGE_KEY) ?? "";
  let initialSearchInput = hashData?.[2] ?? localStorage.getItem(SEARCH_KEY) ?? "";

  const [language, setLanguage] = createSignal(defaultLanguage(initialLanguage));
  const [searchInput, setSearchInput] = createSignal(initialSearchInput);

  createEffect(() => localStorage.setItem(SEARCH_KEY, searchInput()));
  createEffect(() => localStorage.setItem(LANGUAGE_KEY, language().id));

  const selectedStation = createMemo(() => {
    const needle = searchInput();
    const lang = language().id;

    return stations.find((x) => x[lang] === needle);
  });

  createEffect(() => {
    if (searchInput().length === 0) {
      history.replaceState(null, document.title, ".");
    } else {
      location.hash = `/${language().id}/${searchInput().replace(FORBIDDEN_CHARACTERS, "")}`;
    }
  });

  const setLanguageKeepStation = (newLanguage: Language) => {
    setSearchInput(selectedStation()?.[newLanguage.id] ?? "");
    setLanguage(newLanguage);
  };

  const setCurrentStation = (station: StationInfo) => {
    setSearchInput(station[language().id]);
  };

  return (
    <LanguageContext.Provider value={language}>
      <SetCurrentStationContext.Provider value={setCurrentStation}>
        <main>
          <div class="input">
            <StationPicker searchInput={searchInput()} setSearchInput={setSearchInput} />
            <LanguagePicker language={language()} setLanguage={setLanguageKeepStation} />
          </div>

          <Show when={selectedStation() !== undefined}>
            <Station station={selectedStation()!} />
          </Show>
        </main>
      </SetCurrentStationContext.Provider>
    </LanguageContext.Provider>
  );
}
