import { Accessor, For, Match, Switch, createContext, createEffect, createMemo, createResource, createSignal, onCleanup, useContext } from "solid-js";
import { StationInfo, stations } from "./data";
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

function useNow() {
  const [now, setNow] = createSignal(new Date());
  const interval = setInterval(() => setNow(new Date()), 1e3);

  onCleanup(() => clearInterval(interval));

  return now;
}

async function fetchUpcomingTrains(station: StationInfo) {
  const resp = await fetch(
      `https://fetch-subway.gsq.workers.dev/upcoming/${station.ko}`);
  const json: readonly Train[] = await resp.json();

  return json;
}

async function fetchCongestion({ language, line, train }: { language: Language, line: string, train: string }) {
  const resp = await fetch(
      `https://fetch-subway.gsq.workers.dev/congestion/${line}/${train}`);
  const json: readonly number[] = await resp.json();

  return json
    .map((congestionId, i) => ({ car: i + 1, value: congestionId, label: language.congestionLabels[congestionId] }));
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
        {expanded() ? "▼" : "►"}
        {" "}
        {language().formatSeconds((now().valueOf() - eta()) / 1e3 | 0)}
      </div>

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
    </div>
  );
}

function TrainsByDirection(props: { trains: readonly Train[] }) {
  const sortedGroupedTrains = createMemo(() => {
    const groupedTrains: Record<string, Train[]> = {};

    for (const train of props.trains) {
      (groupedTrains[train.lineName] ??= []).push(train);
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

  return (
    <div class="trains">
      <For each={sortedGroupedTrains()}>
        {(trains) => (
          <div class="group">
            <h3>
              <span class="line">{trains[0].line}</span>
              {trains[0].lineName}
            </h3>

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
  const language = useContext(LanguageContext)!;
  const [trains, { refetch }] = createResource(() => props.station, fetchUpcomingTrains, { initialValue: [] });
  const interval = setInterval(() => refetch(), 30_000);

  onCleanup(() => clearInterval(interval));

  return (
    <div class="station">
      <h2>{props.station[language().id]}</h2>

      <TrainsByDirection trains={trains()} />
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

  return (
    <div class="section-picker">
      <datalist id="stations">
        <For each={stations}>
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

  const [searchInput, setSearchInput] = createSignal(localStorage.getItem(SEARCH_KEY) ?? "");
  const [language, setLanguage] = createSignal(defaultLanguage(localStorage.getItem(LANGUAGE_KEY) ?? ""));

  createEffect(() => localStorage.setItem(SEARCH_KEY, searchInput()));
  createEffect(() => localStorage.setItem(LANGUAGE_KEY, language().id));

  const selectedStation = createMemo(() => {
    const needle = searchInput();
    const lang = language().id;

    return stations.find((x) => x[lang] === needle);
  });

  return (
    <LanguageContext.Provider value={language}>
      <main>
        <div class="input">
          <StationPicker searchInput={searchInput()} setSearchInput={setSearchInput} />
          <LanguagePicker language={language()} setLanguage={setLanguage} />
        </div>

        {selectedStation() !== undefined && <Station station={selectedStation()!} />}
      </main>
    </LanguageContext.Provider>
  );
}
