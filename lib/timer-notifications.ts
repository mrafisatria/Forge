import { apiRequest } from './api';

export type NotificationState = 'loading' | 'ready' | 'enabled' | 'denied' | 'unsupported' | 'install' | 'error';
export type TimerIdentity = { id: string; deadline: number; duration: number };

export class TimerNotifications {
  private token: string;
  private registration: ServiceWorkerRegistration | null = null;
  private publicKey: string | null = null;
  private subscriptionId: string | null = null;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(token: string) { this.token = token; }

  async initialize(): Promise<NotificationState> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (isIOS && !standalone) return 'install';
    if (Notification.permission === 'denied') return 'denied';
    this.registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    this.registration = await navigator.serviceWorker.ready;
    const config = await apiRequest<{ public_key: string }>('/push/config', { token: this.token, signal: AbortSignal.timeout(10000) });
    this.publicKey = config.public_key;
    const subscription = await this.registration.pushManager.getSubscription();
    if (subscription && Notification.permission === 'granted') {
      await this.saveSubscription(subscription);
      return 'enabled';
    }
    return 'ready';
  }

  private async saveSubscription(subscription: PushSubscription) {
    if (this.disposed) return;
    const result = await apiRequest<{ id: string }>('/push/subscriptions', {
      method: 'POST', token: this.token, body: { subscription: subscription.toJSON() }, signal: AbortSignal.timeout(10000),
    });
    if (!this.disposed) this.subscriptionId = result.id;
  }

  async enable(): Promise<NotificationState> {
    // Call requestPermission synchronously from the explicit button click on iOS.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'ready';
    if (!this.registration || !this.publicKey) return 'error';
    const bytes = Uint8Array.from(atob(this.publicKey.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    const subscription = await this.registration.pushManager.getSubscription()
      ?? await this.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    await this.saveSubscription(subscription);
    return 'enabled';
  }

  send(timer: TimerIdentity, action: 'start' | 'cancel' | 'presence', foreground: boolean): Promise<void> {
    const subscription = this.subscriptionId;
    if (!subscription) return Promise.resolve();
    // Serialize start/replace/cancel, while SQL tombstones also cover uncertain network outcomes.
    const result = this.queue.catch(() => {}).then(async () => {
      await apiRequest('/push/timer', { method: 'POST', token: this.token, keepalive: true,
        signal: AbortSignal.timeout(10000),
        body: { ...timer, subscription_id: subscription, action, foreground },
      });
    });
    this.queue = result;
    return result;
  }

  async disable(): Promise<NotificationState> {
    if (this.subscriptionId) {
      await apiRequest('/push/subscriptions', { method: 'DELETE', token: this.token, body: { id: this.subscriptionId }, signal: AbortSignal.timeout(10000) });
      this.subscriptionId = null;
    }
    const subscription = await this.registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
    return 'ready';
  }

  dispose() { this.disposed = true; }
}
