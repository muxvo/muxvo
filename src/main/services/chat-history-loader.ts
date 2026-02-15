/**
 * Chat History Loader
 *
 * Lazy-loads chat history data on demand when the panel opens.
 */

export function createChatHistoryLoader() {
  let dataLoaded = false;
  let memory = 0;

  return {
    get isDataLoaded() { return dataLoaded; },
    get memoryUsage() { return memory; },

    async loadOnDemand() {
      dataLoaded = true;
      memory = 1024; // Simulated memory usage
    },
  };
}
