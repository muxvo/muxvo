/**
 * Marketplace Store
 *
 * State machine for marketplace with offline mode support.
 */

interface MarketplaceConfig {
  networkAvailable: boolean;
}

interface MarketplaceAction {
  type: 'OPEN' | 'SEARCH' | 'LOAD_MORE';
}

export function createMarketplaceStore(config: MarketplaceConfig) {
  let state = config.networkAvailable ? 'Ready' : 'Offline';
  const networkAvailable = config.networkAvailable;

  function dispatch(action: MarketplaceAction): void {
    switch (action.type) {
      case 'OPEN':
        if (!networkAvailable) {
          state = 'Offline';
        } else {
          state = 'Browsing';
        }
        break;
    }
  }

  function getState(): string {
    return state;
  }

  function getMessage(): string {
    if (state === 'Offline') {
      return '无法连接聚合源，请检查网络连接';
    }
    return '';
  }

  function showsLocalData(): boolean {
    return state === 'Offline';
  }

  return {
    dispatch,
    getState,
    getMessage,
    showsLocalData,
  };
}
