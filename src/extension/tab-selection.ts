export function selectTabsByIds(tabs: chrome.tabs.Tab[], tabIds: number[]): chrome.tabs.Tab[] {
  const tabMap = new Map<number, chrome.tabs.Tab>();
  tabs.forEach((tab) => {
    if (typeof tab.id === 'number') {
      tabMap.set(tab.id, tab);
    }
  });
  return tabIds.map((id) => tabMap.get(id)).filter((tab): tab is chrome.tabs.Tab => Boolean(tab));
}
