import webpush from 'web-push';
import type { PushTransport } from './push.ts';

export function createPushTransport(send = fetch): PushTransport {
  return {
    generateKeys: () => webpush.generateVAPIDKeys(),
    async send(subscription, payload, keys) {
      const details = webpush.generateRequestDetails(subscription, payload, {
        vapidDetails: { subject: 'https://forgezone.vercel.app', ...keys },
        TTL: 60, urgency: 'high', contentEncoding: 'aes128gcm',
      });
      const response = await send(details.endpoint, {
        method: details.method, headers: details.headers, body: new Uint8Array(details.body!),
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      await response.body?.cancel();
      return response.status;
    },
  };
}
