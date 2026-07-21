// lib/publishers/linkedin.ts
// Publishes a single-image (or text-only) post LIVE to a member's LinkedIn feed
// via the legacy UGC Posts API. LinkedIn has no usable draft for member posts, so
// this is an immediate publish. Unlike the other publishers, images are uploaded
// directly to LinkedIn's media service (3-step assets flow) — LinkedIn does not
// accept a public image URL. The row's hashtags are appended to the bottom of the
// post body. No `any` anywhere.

export interface LinkedinPublishResult {
  /** The live post permalink. */
  url: string;
  /** The ugcPost URN. */
  id: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const API = "https://api.linkedin.com";

/** Pull the LinkedIn error message out of a non-2xx JSON body, if present. */
function linkedinErrorMessage(json: unknown, status: number): string {
  if (isRecord(json) && typeof json.message === "string") {
    return json.message;
  }
  return `LinkedIn API error (HTTP ${status}).`;
}

/** Resolve the member `sub` from the access token (needs openid/profile scope). */
async function resolveMemberSub(accessToken: string): Promise<string> {
  const res = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json: unknown = await res.json().catch(() => null);
  if (res.ok && isRecord(json) && typeof json.sub === "string") {
    return json.sub;
  }
  throw new Error(
    "Couldn't resolve your LinkedIn member id. Generate the token with the " +
      "'openid' and 'profile' scopes, or set LINKEDIN_USER_ID in credentials.env.",
  );
}

/** Register an upload slot, PUT the image bytes, and return the asset URN. */
async function uploadImageAsset(
  accessToken: string,
  authorUrn: string,
  imageBytes: Buffer,
): Promise<string> {
  // Step 1 — register the upload.
  const registerRes = await fetch(`${API}/v2/assets?action=registerUpload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
      },
    }),
  });
  const registerJson: unknown = await registerRes.json().catch(() => null);
  if (!registerRes.ok || !isRecord(registerJson) || !isRecord(registerJson.value)) {
    throw new Error(linkedinErrorMessage(registerJson, registerRes.status));
  }
  const value = registerJson.value;
  const asset = typeof value.asset === "string" ? value.asset : "";
  const mechanism = value.uploadMechanism;
  let uploadUrl = "";
  if (isRecord(mechanism)) {
    const http =
      mechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ];
    if (isRecord(http) && typeof http.uploadUrl === "string") {
      uploadUrl = http.uploadUrl;
    }
  }
  if (!asset || !uploadUrl) {
    throw new Error("LinkedIn returned an unexpected upload-registration shape.");
  }

  // Step 2 — PUT the bytes to the signed upload URL.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "image/png",
    },
    // Wrap in a fresh Uint8Array so the body satisfies fetch's BodyInit type.
    body: new Uint8Array(imageBytes),
  });
  if (!putRes.ok) {
    throw new Error(`LinkedIn image upload failed (HTTP ${putRes.status}).`);
  }

  return asset;
}

/**
 * Publish a LIVE LinkedIn post. Resolves the author URN, optionally uploads the
 * image, creates the ugcPost, then (best-effort) adds the hashtags as the first
 * comment. Any non-2xx in the publish path throws with LinkedIn's `message`.
 */
export async function publishLinkedinPost(opts: {
  accessToken: string;
  memberSub?: string;
  imageBytes?: Buffer | null;
  text: string;
  hashtags?: string;
}): Promise<LinkedinPublishResult> {
  const { accessToken, imageBytes, text } = opts;

  const sub =
    opts.memberSub && opts.memberSub.trim()
      ? opts.memberSub.trim()
      : await resolveMemberSub(accessToken);
  const authorUrn = `urn:li:person:${sub}`;

  // Hashtags go at the bottom of the post body (after a blank line), not as a
  // separate first comment — keeps them visible in the post itself.
  const hashtags = opts.hashtags?.trim();
  const commentary = hashtags ? `${text.trimEnd()}\n\n${hashtags}` : text;

  // Build the share content — IMAGE when we have bytes, else NONE (text-only).
  let shareMediaCategory = "NONE";
  const media: Array<Record<string, unknown>> = [];
  if (imageBytes && imageBytes.length > 0) {
    const asset = await uploadImageAsset(accessToken, authorUrn, imageBytes);
    shareMediaCategory = "IMAGE";
    media.push({ status: "READY", media: asset });
  }

  const shareContent: Record<string, unknown> = {
    shareCommentary: { text: commentary },
    shareMediaCategory,
  };
  if (media.length > 0) shareContent.media = media;

  const postRes = await fetch(`${API}/v2/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": shareContent,
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    }),
  });
  const postJson: unknown = await postRes.json().catch(() => null);
  if (!postRes.ok || !isRecord(postJson) || typeof postJson.id !== "string") {
    throw new Error(linkedinErrorMessage(postJson, postRes.status));
  }
  const postUrn = postJson.id;
  const url = `https://www.linkedin.com/feed/update/${postUrn}/`;

  return { url, id: postUrn };
}
