import { NexaApi } from '../main/preload';

declare global {
  interface Window {
    nexa: NexaApi;
  }
}

export {};
