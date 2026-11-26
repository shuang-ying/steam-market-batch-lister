import { getActiveAppIdFromPage, resolveSteamPageContext } from './inventory';
import { BatchListerUI } from './ui';

const INVENTORY_URL_PATTERN =
  /^https?:\/\/steamcommunity\.com\/(id\/[^/]+|profiles\/\d+)\/inventory\/?(?:[?#].*)?$/i;

function isInventoryPage(): boolean {
  return INVENTORY_URL_PATTERN.test(window.location.href);
}

function waitForDomReady(): Promise<void> {
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

async function waitForSteamInventoryReady(timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      document.body &&
      (getActiveAppIdFromPage() > 0 || document.getElementById('inventories'))
    ) {
      return true;
    }
    await new Promise((r) => window.setTimeout(r, 200));
  }
  return Boolean(document.body);
}

let mountedInstance: BatchListerUI | null = null;

export default async function main(): Promise<void> {
  if (!isInventoryPage()) {
    return;
  }

  await waitForDomReady();
  await waitForSteamInventoryReady();

  const ctx = resolveSteamPageContext();
  if (ctx.viewingOwnProfile === false) {
    return;
  }

  if (!mountedInstance) {
    mountedInstance = new BatchListerUI();
  }
  await mountedInstance.mount();
}
