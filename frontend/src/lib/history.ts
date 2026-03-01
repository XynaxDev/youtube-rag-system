export interface HistoryItem {
  id: string;
  type: "Summary" | "Comparison";
  title: string;
  channel: string;
  date: string;
  timestamp: number;
  result: any;
}

export function saveHistory(item: Omit<HistoryItem, "id" | "timestamp">) {
  const current = getHistory();
  const newItem: HistoryItem = {
    ...item,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  
  // Keep only last 50
  const updated = [newItem, ...current].slice(0, 50);
  localStorage.setItem("clipiq_history", JSON.stringify(updated));
}

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem("clipiq_history");
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function clearHistory() {
  localStorage.removeItem("clipiq_history");
}

export function deleteHistoryItem(id: string) {
  const current = getHistory();
  const updated = current.filter(item => item.id !== id);
  localStorage.setItem("clipiq_history", JSON.stringify(updated));
}

export function renameHistoryItem(id: string, newTitle: string) {
  const current = getHistory();
  const updated = current.map(item => 
    item.id === id ? { ...item, title: newTitle } : item
  );
  localStorage.setItem("clipiq_history", JSON.stringify(updated));
}
