import { useSyncExternalStore } from "react";

/**
 * Чи є звʼязок.
 *
 * navigator.onLine бреше в один бік: false означає «мережі точно немає», а true
 * означає лише «інтерфейс піднято» — Wi-Fi без інтернету теж дає true. Тому це
 * годиться для підказки «офлайн», але рішення «надсилати чи скласти в чергу»
 * має спиратись на результат самого запиту (OfflineError), а не на цей прапорець.
 */
function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
