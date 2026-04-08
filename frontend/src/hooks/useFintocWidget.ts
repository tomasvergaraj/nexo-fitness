/**
 * useFintocWidget — carga el script de Fintoc dinámicamente y expone openWidget().
 *
 * Fintoc no usa redirección — su widget es un iframe JavaScript.
 * Los callbacks NO se pasan a Fintoc.create() porque el widget intenta
 * serializar las opciones vía postMessage (DataCloneError).
 * En cambio, escuchamos los eventos del widget con window.addEventListener.
 */
import { useCallback, useEffect, useRef } from 'react';

/// <reference types="vite/client" />

declare global {
  interface Window {
    Fintoc?: {
      create: (options: FintocWidgetOptions) => FintocWidget;
    };
  }
}

interface FintocWidgetOptions {
  widgetToken: string;
  product: 'payments' | 'movements' | 'subscriptions';
  publicKey?: string;
}

interface FintocWidget {
  open: () => void;
  close: () => void;
  destroy: () => void;
}

// Eventos que emite el widget via postMessage
interface FintocMessageEvent {
  type: 'fintoc:success' | 'fintoc:exit' | 'fintoc:error';
  data?: unknown;
  error?: unknown;
}

const FINTOC_SCRIPT_URL = 'https://js.fintoc.com/v1/';
const SCRIPT_ID = 'fintoc-js';

function loadFintocScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Fintoc) {
      resolve();
      return;
    }
    if (document.getElementById(SCRIPT_ID)) {
      const check = setInterval(() => {
        if (window.Fintoc) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = FINTOC_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar el widget de Fintoc'));
    document.head.appendChild(script);
  });
}

interface UseFintocWidgetOptions {
  onSuccess?: (data: unknown) => void;
  onExit?: () => void;
  onError?: (error: unknown) => void;
}

export function useFintocWidget({ onSuccess, onExit, onError }: UseFintocWidgetOptions = {}) {
  const widgetRef = useRef<FintocWidget | null>(null);
  const callbacksRef = useRef({ onSuccess, onExit, onError });

  // Keep callbacks ref up to date without re-registering the listener
  useEffect(() => {
    callbacksRef.current = { onSuccess, onExit, onError };
  }, [onSuccess, onExit, onError]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only handle Fintoc messages
      if (!event.data || typeof event.data !== 'object') return;
      const msg = event.data as FintocMessageEvent;

      switch (msg.type) {
        case 'fintoc:success':
          widgetRef.current?.destroy();
          widgetRef.current = null;
          callbacksRef.current.onSuccess?.(msg.data);
          break;
        case 'fintoc:exit':
          widgetRef.current?.destroy();
          widgetRef.current = null;
          callbacksRef.current.onExit?.();
          break;
        case 'fintoc:error':
          callbacksRef.current.onError?.(msg.error);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    return () => {
      widgetRef.current?.destroy();
    };
  }, []);

  const openWidget = useCallback(async (widgetToken: string) => {
    try {
      await loadFintocScript();

      if (!window.Fintoc) {
        throw new Error('Fintoc no disponible');
      }

      widgetRef.current?.destroy();

      // No pasamos callbacks aquí — los recibimos via postMessage arriba
      const options: FintocWidgetOptions = {
        widgetToken,
        product: 'payments',
      };
      const publicKey = import.meta.env.VITE_FINTOC_PUBLIC_KEY;
      if (publicKey) options.publicKey = publicKey;

      widgetRef.current = window.Fintoc.create(options);

      widgetRef.current.open();
    } catch (error) {
      callbacksRef.current.onError?.(error);
    }
  }, []);

  return { openWidget };
}
