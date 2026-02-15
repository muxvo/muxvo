/**
 * Browser Machine
 *
 * State machine for the Skill browser (PRD 6.14).
 * States: Closed -> Loading -> Ready/PartialReady/LoadError
 * Sub-views within Ready: Discovery, SearchResults, PackageDetail
 */

interface Package {
  id: string;
  [key: string]: unknown;
}

interface SourceLoadedPayload {
  source: string;
  packages: Package[];
}

interface SourceFailedPayload {
  source: string;
  error: string;
}

interface BrowserContext {
  loadedSources: string[];
  failedSources: string[];
  error: string | null;
  showRetryButton: boolean;
  view: 'Discovery' | 'SearchResults' | 'PackageDetail';
  selectedPackageId: string | null;
  activeFilter: string | null;
  filteredPackages: Package[];
  displayedPackages: Package[];
  allPackages: Package[];
}

const TOTAL_SOURCES = 6;

export interface BrowserMachine {
  state: string;
  context: BrowserContext;
  send(event: string, payload?: Record<string, unknown>): void;
}

export function createBrowserMachine(): BrowserMachine {
  const context: BrowserContext = {
    loadedSources: [],
    failedSources: [],
    error: null,
    showRetryButton: false,
    view: 'Discovery',
    selectedPackageId: null,
    activeFilter: null,
    filteredPackages: [],
    displayedPackages: [],
    allPackages: [],
  };

  let state = 'Closed';

  function checkAllSourcesResolved(): void {
    const total = context.loadedSources.length + context.failedSources.length;
    if (total >= TOTAL_SOURCES) {
      if (context.loadedSources.length === 0) {
        state = 'LoadError';
        context.error = '无法连接聚合源';
        context.showRetryButton = true;
      } else if (context.failedSources.length > 0) {
        state = 'PartialReady';
      } else {
        state = 'Ready';
        context.view = 'Discovery';
      }
    }
  }

  const machine: BrowserMachine = {
    get state() {
      return state;
    },
    set state(v: string) {
      state = v;
    },
    context,

    send(event: string, payload?: Record<string, unknown>) {
      switch (state) {
        case 'Closed':
          if (event === 'OPEN') {
            state = 'Loading';
            context.loadedSources = [];
            context.failedSources = [];
            context.error = null;
            context.showRetryButton = false;
            context.displayedPackages = [];
            context.allPackages = [];
          }
          break;

        case 'Loading':
          if (event === 'SOURCE_LOADED') {
            const p = payload as unknown as SourceLoadedPayload;
            if (!context.loadedSources.includes(p.source)) {
              context.loadedSources.push(p.source);
            }
            if (p.packages) {
              context.allPackages.push(...(p.packages as Package[]));
              context.displayedPackages = [...context.allPackages];
            }
            checkAllSourcesResolved();
          } else if (event === 'SOURCE_FAILED') {
            const p = payload as unknown as SourceFailedPayload;
            if (!context.failedSources.includes(p.source)) {
              context.failedSources.push(p.source);
            }
            checkAllSourcesResolved();
          } else if (event === 'ALL_SOURCES_LOADED') {
            state = 'Ready';
            context.view = 'Discovery';
          }
          break;

        case 'PartialReady':
          if (event === 'SOURCE_LOADED') {
            const p = payload as unknown as SourceLoadedPayload;
            // Remove from failed
            context.failedSources = context.failedSources.filter(
              (s) => s !== p.source,
            );
            if (!context.loadedSources.includes(p.source)) {
              context.loadedSources.push(p.source);
            }
            if (context.failedSources.length === 0) {
              state = 'Ready';
              context.view = 'Discovery';
            }
          } else if (event === 'ESC') {
            state = 'Closed';
          }
          break;

        case 'LoadError':
          if (event === 'RETRY') {
            state = 'Loading';
            context.loadedSources = [];
            context.failedSources = [];
            context.error = null;
            context.showRetryButton = false;
          }
          break;

        case 'Ready':
          if (event === 'ESC') {
            state = 'Closed';
          } else if (event === 'SEARCH') {
            context.view = 'SearchResults';
          } else if (event === 'CLEAR_SEARCH') {
            context.view = 'Discovery';
          } else if (event === 'SELECT_PACKAGE') {
            context.view = 'PackageDetail';
            context.selectedPackageId =
              (payload as { packageId: string }).packageId;
          } else if (event === 'BACK') {
            context.view = 'Discovery';
          } else if (event === 'FILTER_BY_SOURCE') {
            context.activeFilter =
              (payload as { source: string }).source;
            context.filteredPackages = context.allPackages.filter(
              () => true, // simplified filter
            );
          } else if (event === 'ALL_SOURCES_LOADED') {
            // no-op, already ready
          }
          break;
      }
    },
  };

  return machine;
}
