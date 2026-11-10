import fs from "node:fs";
import path from "node:path";
import { WORK_LIST_MESSAGE } from "./pmClient.js";

type FirebaseMessaging = {
  send: (message: Record<string, unknown>) => Promise<string>;
};

let messaging: FirebaseMessaging | null | undefined;

function loadServiceAccount(): Record<string, unknown> | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "").trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("{")) return JSON.parse(raw) as Record<string, unknown>;
    const filePath = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
    if (!fs.existsSync(filePath)) {
      console.error("FIREBASE_SERVICE_ACCOUNT_JSON file not found:", filePath);
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    console.error("Failed to load Firebase service account:", error instanceof Error ? error.message : error);
    return null;
  }
}

async function getMessaging(): Promise<FirebaseMessaging | null> {
  if (messaging !== undefined) return messaging;
  const account = loadServiceAccount();
  if (!account) {
    messaging = null;
    return null;
  }
  try {
    const admin = await import("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(account as Parameters<typeof admin.credential.cert>[0]),
      });
    }
    messaging = admin.messaging() as unknown as FirebaseMessaging;
    return messaging;
  } catch (error) {
    console.error("firebase-admin init failed:", error instanceof Error ? error.message : error);
    messaging = null;
    return null;
  }
}

export async function sendWorkListPush(input: {
  fcmToken: string;
  deliveryId: string;
}): Promise<{ sent: boolean; errorCode?: string }> {
  const token = input.fcmToken.trim();
  if (!token) return { sent: false, errorCode: "NO_TOKEN" };
  const client = await getMessaging();
  if (!client) return { sent: false, errorCode: "FCM_NOT_CONFIGURED" };
  try {
    await client.send({
      token,
      notification: {
        title: "Attendify",
        body: WORK_LIST_MESSAGE,
      },
      data: {
        type: "WORK_LIST_REMINDER",
        deliveryId: input.deliveryId,
        message: WORK_LIST_MESSAGE,
      },
      android: {
        priority: "high",
        notification: {
          channelId: "work_list",
          tag: input.deliveryId,
        },
      },
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FCM_SEND_FAILED";
    console.error("FCM send failed:", message);
    return { sent: false, errorCode: "FCM_SEND_FAILED" };
  }
}
