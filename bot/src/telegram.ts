// Tiny Telegram Bot API client. Tests swap it for a recorder.
export interface Tg { call(method: string, params: Record<string, unknown>): Promise<any> }

export function telegram(token: string, fetchImpl: typeof fetch = fetch): Tg {
  return {
    async call(method, params) {
      const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
      });
      const j = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
      if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
      return j.result;
    },
  };
}

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
