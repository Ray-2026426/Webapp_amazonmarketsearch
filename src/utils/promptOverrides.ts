const STORAGE_KEY = 'amzdev_ai_prompts';

function loadPromptOverrides(): Record<string, string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function persistPromptOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
}

export function savePromptItem(id: string, prompt: string): void {
  const overrides = loadPromptOverrides();
  overrides[id] = prompt;
  persistPromptOverrides(overrides);
}

export function resetPromptToDefault(id: string): void {
  const overrides = loadPromptOverrides();
  if (!(id in overrides)) return;
  delete overrides[id];
  persistPromptOverrides(overrides);
}
