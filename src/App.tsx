import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  useContext,
} from "solid-js";
import {
  StationInfo,
  stations,
  stationsById,
  SupportedLine,
  supportedLines,
} from "./data";
import "./App.css";

interface Language {
  readonly id: "en" | "ko" | "ja";
  readonly display: string;
  readonly congestionLabels: readonly [string, string, string, string];

  readonly nowDisplay: string;

  formatDuration(
    mins: number,
    secs: number,
    inFuture: boolean,
  ): readonly (string | false)[];
  formatLineNoData(line: string): string;
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
    nowDisplay: "지금",
    formatDuration: (
      mins,
      secs,
      inFuture,
    ) => [mins > 0 && `${mins}분 `, `${secs}초`, !inFuture && " 전"],
    formatLineNoData: (line) => `${line}호선은 혼잡 데이터가 없습니다`,
  },
  {
    id: "en",
    display: "English",
    congestionLabels: ["Comfortable", "Normal", "Crowded", "Very crowded"],
    nowDisplay: "Now",
    formatDuration: (
      mins,
      secs,
      inFuture,
    ) => [
      mins > 0 && `${mins}'`,
      `${secs}"`,
      !inFuture && " ago",
    ],
    formatLineNoData: (line) => `Line ${line} has no congestion data`,
  },
  {
    id: "ja",
    display: "日本語",
    congestionLabels: ["余裕", "普通", "注意", "混雑"],
    nowDisplay: "今",
    formatDuration: (
      mins,
      secs,
      inFuture,
    ) => [mins > 0 && `${mins}分`, `${secs}秒`, !inFuture && "前"],
    formatLineNoData: (line) => `${line}号線は混雑データがありません`,
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

async function fetchUpcomingTrains(station: StationInfo, signal: AbortSignal) {
  const resp = await fetch(
    `https://fetch-subway.gsq.workers.dev/upcoming/${station.id}`,
    { signal },
  );
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  const json: readonly Train[] = await resp.json();

  return json;
}

async function fetchCongestion(
  { language, line, train }: {
    language: Language;
    line: string;
    train: string;
  },
  signal: AbortSignal,
) {
  if (line === "9") {
    throw new Error(language.formatLineNoData(line));
  }

  const resp = await fetch(
    `https://fetch-subway.gsq.workers.dev/congestion/${line}/${train}`,
    { signal },
  );
  if (!resp.ok) {
    throw new Error(await resp.text());
  }
  const json: readonly number[] = await resp.json();

  return json.map((congestionId, i) => ({ car: i + 1, value: congestionId }));
}

function keepLastValidValue<T, Args extends readonly any[]>(
  args: () => readonly [...Args],
  fetch: (...args: readonly [...Args, signal: AbortSignal]) => Promise<T>,
  opts: { intervalMs: number },
): [
  lastValidResult: Accessor<T | undefined>,
  error: Accessor<string | undefined>,
  loading: Accessor<boolean>,
] {
  const [result, setResult] = createSignal<T>();
  const [error, setError] = createSignal<string>();
  const [loading, setLoading] = createSignal(true);

  const updateResult = async (args: Args, signal: AbortSignal) => {
    setLoading(true);

    try {
      const newResult = await fetch(...args, signal);

      if (signal.aborted) {
        return;
      }

      setResult(() => newResult);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${e}`);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    const abort = new AbortController();
    const signal = abort.signal;

    // Update result immediately, so future changes to `args()` immediately trigger a reload
    // and reset the interval.
    updateResult(args() as Args, signal);

    const interval = setInterval(
      () => updateResult(args() as Args, signal),
      opts.intervalMs,
    );

    onCleanup(() => {
      clearInterval(interval);
      abort.abort();
    });
  });

  return [result, error, loading];
}

function TrainIcon(props: { position: "first" | "other" | "last" }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <Switch>
        <Match when={props.position === "first"}>
          <path d="M20 0 L180 0 Q200 0, 200 20 L200 90 Q200 100, 190 100 L10 100 Q0 100, 0 90 L0 80 Q10 0, 60 0" />
        </Match>

        <Match when={props.position === "last"}>
          <path d="M20 0 L140 0 Q190 0, 200 80 L200 90 Q200 100, 190 100 L10 100 Q0 100, 0 90 L0 20 Q0 0, 20 0" />
        </Match>

        <Match when={true}>
          <path d="M20 0 L180 0 Q200 0, 200 20 L200 90 Q200 100, 190 100 L10 100 Q0 100, 0 90 L0 20 Q0 0, 20 0" />
        </Match>
      </Switch>
    </svg>
  );
}

function PlaceholderTrain(props: { state: "?" | "..." }) {
  const text = createMemo(() => {
    return props.state === "..." ? "⋯" : props.state;
  });

  return (
    <For each={[1, 2, 3, 4, 5]}>
      {(index) => (
        <Show
          when={index !== 3}
          fallback={<div class="text-icon">{text()}</div>}
        >
          <div class="car">
            <div class="icon ve">
              <TrainIcon
                position={index === 1
                  ? "first"
                  : index === 5
                  ? "last"
                  : "other"}
              />
            </div>
          </div>
        </Show>
      )}
    </For>
  );
}

function ErrorMessage(props: { message: string | undefined }) {
  return (
    <Show when={props.message !== undefined}>
      <div class="error">
        <span>{props.message}</span>
      </div>
    </Show>
  );
}

function Train(
  props: {
    line: string;
    lineName: string;
    train: string;
    eta: number;
    etaMessage: string;
  },
) {
  const language = useContext(LanguageContext)!;
  const [expanded, setExpanded] = createSignal(false);

  const [congestion, congestionError, congestionLoading] = keepLastValidValue(
    () => [props.line, props.train],
    async (line: string, train: string, signal: AbortSignal) =>
      expanded()
        ? await fetchCongestion({ language: language(), line, train }, signal)
        : [],
    { intervalMs: 20_000 },
  );

  const now = useNow();
  const eta = createMemo(() =>
    new Date(props.eta).valueOf() + new Date().getTimezoneOffset() * 60e3
  );
  const timeDisplay = createMemo(() => {
    const lang = language();
    const totalSeconds = (eta() - now().valueOf()) / 1e3 | 0;

    if (totalSeconds <= 1 && totalSeconds >= -20) {
      return lang.nowDisplay;
    }

    const mins = Math.abs(totalSeconds / 60 | 0);
    const secs = Math.abs(totalSeconds % 60);
    const segments = lang.formatDuration(mins, secs, totalSeconds > 0);
    let result = "";

    for (const segment of segments) {
      if (typeof segment === "string") {
        result += segment;
      }
    }

    return result;
  });

  return (
    <div class="train" data-train-id={props.train}>
      <div class="toggle" role="button" onClick={() => setExpanded((e) => !e)}>
        <span class="bullet">
          {expanded() ? "● " : "○ "}
        </span>
        {timeDisplay()}
      </div>

      <Show when={expanded()}>
        <div class="content">
          <div class="cars">
            <For
              each={congestion()}
              fallback={
                <>
                  <PlaceholderTrain state={congestionLoading() ? "..." : "?"} />
                </>
              }
            >
              {({ car, value }) => (
                <div class="car">
                  <div class={`icon v${value}`}>
                    <div class="car-number">{car}</div>
                    <TrainIcon
                      position={car === 1
                        ? "first"
                        : car === congestion()!.length
                        ? "last"
                        : "other"}
                    />
                  </div>
                  <span>{language().congestionLabels[value]}</span>
                </div>
              )}
            </For>
          </div>

          <ErrorMessage message={congestionError()} />
        </div>
      </Show>
    </div>
  );
}

interface TrainGroup {
  trains: readonly { train: Train }[];
  previousStation?: string;
}

function TrainsByDirection(
  props: { station: StationInfo; groupedTrains: readonly TrainGroup[] },
) {
  const language = useContext(LanguageContext)!;
  const setCurrentStation = useContext(SetCurrentStationContext)!;

  const stationName = (stationId: string) =>
    stationsById[stationId]?.[language().id] ?? stationId;

  return (
    <div class="trains">
      <For each={props.groupedTrains}>
        {(group, _, anyTrain = group.trains[0].train) => (
          <div
            class="group"
            style={`--line-accent: ${
              lineColors[anyTrain.line as SupportedLine]
            }`}
          >
            <div class="header">
              <h1>
                <span class="line">{anyTrain.line}</span>
              </h1>

              <h2>
                <Show
                  when={anyTrain.destination !== undefined}
                  fallback={anyTrain.lineName}
                >
                  <Show when={group.previousStation !== undefined}>
                    <span
                      class="previous"
                      onClick={[
                        setCurrentStation,
                        stationsById[group.previousStation!],
                      ]}
                    >
                      {stationName(group.previousStation!)}
                    </span>
                    <span class="sep">›</span>
                    <br />
                  </Show>
                  <span class="current" title={anyTrain.lineName}>
                    {props.station[language().id]}
                  </span>
                  <span class="sep">›</span>
                  <span
                    class="next"
                    onClick={[
                      setCurrentStation,
                      stationsById[anyTrain.nextStation!],
                    ]}
                  >
                    {stationName(anyTrain.nextStation!)}
                  </span>
                  <Show when={anyTrain.destination !== anyTrain.nextStation}>
                    <span class="sep">⋯</span>
                    <span class="last">
                      {stationName(anyTrain.destination!)}
                    </span>
                  </Show>
                </Show>
              </h2>
            </div>

            <For each={group.trains}>
              {(train) => (
                <Train
                  {...train.train}
                  eta={train.train.eta}
                  etaMessage={train.train.etaMessage}
                />
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}

function Station(props: { station: StationInfo }) {
  const [trains, trainsError] = keepLastValidValue(
    () => [props.station],
    fetchUpcomingTrains,
    { intervalMs: 30_000 },
  );

  const trainsById = createMemo(
    (prevTrains: { [id: string]: { train: Train } }) => {
      const nextTrains = trains() ?? [];
      const result: { [id: string]: { train: Train } } = {};

      for (const nextTrain of nextTrains) {
        const id = nextTrain.train;

        if (id in prevTrains) {
          prevTrains[id].train = nextTrain;
          result[id] = prevTrains[id];
        } else {
          const [train, setTrain] = createSignal(nextTrain);

          result[id] = {
            get train() {
              return train();
            },
            set train(newTrain) {
              setTrain(newTrain);
            },
          };
        }
      }

      return result;
    },
    {},
  );

  const groupsById = createMemo((prevGroups: { [id: string]: TrainGroup }) => {
    const groupedTrains: { [id: string]: { train: Train }[] } = {};

    for (const wrapper of Object.values(trainsById())) {
      const train = wrapper.train;

      if (!(train.line in supportedLines)) {
        continue;
      }

      // `lineName` may contain other data (e.g. "last train"), so we prefer creating
      // our own ID if possible.
      const id =
        train.destination !== undefined && train.nextStation !== undefined
          ? `${train.destination}-${train.nextStation}`
          : train.lineName;

      (groupedTrains[id] ??= []).push(wrapper);
    }

    const result: { [id: string]: TrainGroup } = {};

    for (const [id, newTrains] of Object.entries(groupedTrains)) {
      newTrains.sort((a, b) => a.train.eta - b.train.eta);

      if (id in prevGroups) {
        result[id] = prevGroups[id];
        result[id].trains = newTrains;
      } else {
        const [trains, setTrains] = createSignal(newTrains);

        const anyTrain = newTrains[0].train;
        const station = stationsById[props.station.id];
        const line = station.lines[anyTrain.line as SupportedLine];
        const previousStation = line?.nextStation === anyTrain.nextStation
          ? line!.prevStation
          : line?.prevStation === anyTrain.nextStation
          ? line!.nextStation
          : undefined;

        result[id] = {
          get trains() {
            return trains();
          },
          set trains(newTrains) {
            setTrains(newTrains);
          },

          previousStation,
        };
      }
    }

    return result;
  }, {});

  const sortedGroupedTrains = createMemo(() =>
    Object.values(groupsById()).sort((a, b) => {
      const a0 = a.trains[0].train;
      const b0 = b.trains[0].train;

      if (a0.line !== b0.line) {
        return a0.line.localeCompare(b0.line);
      }
      if (a0.lineName !== b0.lineName) {
        return a0.lineName.localeCompare(b0.lineName);
      }
      return a0.eta - b0.eta;
    })
  );

  return (
    <div class="station">
      <TrainsByDirection
        station={props.station}
        groupedTrains={sortedGroupedTrains()}
      />

      <ErrorMessage message={trainsError()} />
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
const SetCurrentStationContext = createContext<
  (station: StationInfo) => void
>();
const NowContext = createContext<Accessor<Date>>();

const useNow = () => useContext(NowContext)!;

function LanguagePicker(
  props: { language: Language; setLanguage(value: Language): void },
) {
  return (
    <div class="language-picker">
      <For each={languages}>
        {(language) => (
          <>
            <input
              type="radio"
              name="language"
              id={`lang-${language.id}`}
              value={language.id}
              checked={props.language.id === language.id}
              onInput={() => props.setLanguage(language)}
            />
            <label for={`lang-${language.id}`}>{language.display}</label>
          </>
        )}
      </For>
    </div>
  );
}

function StationPicker(
  props: { searchInput: string; setSearchInput(value: string): void },
) {
  const language = useContext(LanguageContext)!;
  const [coords, setCoords] = createSignal<
    GeolocationCoordinates | undefined
  >();
  const sortedStations = createMemo(() => {
    const prop = language().id;
    const loadedCoords = coords();

    if (loadedCoords === undefined) {
      return stations.map((station) => station[prop]);
    }

    const { latitude, longitude } = loadedCoords;
    const distanceToCurrentLocation = (
      coords: { lat: number; lng: number },
    ) => (
      Math.sqrt(
        Math.pow(latitude - coords.lat, 2) +
          Math.pow(longitude - coords.lng, 2),
      )
    );
    const sortedStations = [...stations].filter((station) =>
      station[prop] !== undefined
    );

    sortedStations.sort((a, b) => {
      const aDistance = distanceToCurrentLocation(a);
      const bDistance = distanceToCurrentLocation(b);
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }
      return a[prop]!.localeCompare(b[prop]!);
    });

    return sortedStations.map((station) => station[prop]);
  });

  const updateCoords = async () => {
    navigator.geolocation.getCurrentPosition(
      (geolocation) => setCoords(geolocation.coords),
      undefined,
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 20_000,
      },
    );
  };

  return (
    <div class="section-picker">
      <datalist id="stations">
        <For each={sortedStations()}>
          {(station) => <option value={station} />}
        </For>
      </datalist>

      <input
        name="station"
        list="stations"
        value={props.searchInput}
        onInput={(e) => props.setSearchInput(e.target.value)}
        onFocus={updateCoords}
      />
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

  let initialLanguage = hashData?.[1] ?? localStorage.getItem(LANGUAGE_KEY) ??
    "";
  let initialSearchInput = hashData?.[2] ?? localStorage.getItem(SEARCH_KEY) ??
    "";

  const [language, setLanguage] = createSignal(
    defaultLanguage(initialLanguage),
  );
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
      location.hash = `/${language().id}/${
        searchInput().replace(FORBIDDEN_CHARACTERS, "")
      }`;
    }
  });

  // Compute `now` here to make sure all components update at the same time.
  const [now, setNow] = createSignal(new Date());
  const interval = setInterval(() => setNow(new Date()), 1e3);

  onCleanup(() => clearInterval(interval));

  const setLanguageKeepStation = (newLanguage: Language) => {
    batch(() => {
      setSearchInput(selectedStation()?.[newLanguage.id] ?? "");
      setLanguage(newLanguage);
    });
  };

  const setCurrentStation = (station: StationInfo) => {
    setSearchInput(station[language().id]);
  };

  return (
    <LanguageContext.Provider value={language}>
      <SetCurrentStationContext.Provider value={setCurrentStation}>
        <NowContext.Provider value={now}>
          <main lang={language().id}>
            <div class="input">
              <StationPicker
                searchInput={searchInput()}
                setSearchInput={setSearchInput}
              />
              <LanguagePicker
                language={language()}
                setLanguage={setLanguageKeepStation}
              />
            </div>

            <Show when={selectedStation() !== undefined}>
              <Station station={selectedStation()!} />
            </Show>
          </main>
        </NowContext.Provider>
      </SetCurrentStationContext.Provider>
    </LanguageContext.Provider>
  );
}
