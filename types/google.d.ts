// Ambient declarations for the Google Identity Services (GIS) token client and
// the Google Picker, both loaded at runtime from Google's CDN. The project's TS
// libs don't ship these, so we declare the minimal surface DriveStorage / the
// Drive auth helper use. Kept precise — no `any`.

// ---- Google Identity Services: OAuth token client -------------------------

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  /** Present only on failure (e.g. "access_denied", "interaction_required"). */
  error?: string;
  error_description?: string;
}

interface GoogleTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  /** Called when the request can't even produce a response (popup blocked, etc). */
  error_callback?: (error: { type: string; message?: string }) => void;
  prompt?: "" | "none" | "consent" | "select_account";
}

interface GoogleTokenClient {
  /** Overriding `prompt: ""` attempts a silent (no-UI) token refresh. */
  requestAccessToken(overrideConfig?: { prompt?: "" | "none" | "consent" | "select_account" }): void;
}

// ---- Google Picker --------------------------------------------------------

declare namespace google {
  namespace accounts {
    namespace oauth2 {
      function initTokenClient(config: GoogleTokenClientConfig): GoogleTokenClient;
      function revoke(accessToken: string, done?: () => void): void;
    }
  }

  namespace picker {
    // These are string-valued at runtime ("folders", "picked", …); typed as
    // string constants so response comparisons (data.action === Action.PICKED)
    // type-check against the string `action` field.
    const ViewId: { DOCS: string; FOLDERS: string };
    const Action: { PICKED: string; CANCEL: string; LOADED: string };
    const Feature: {
      MINE_ONLY: string;
      MULTISELECT_ENABLED: string;
      NAV_HIDDEN: string;
      SUPPORT_DRIVES: string;
    };

    interface DocumentObject {
      id: string;
      name: string;
      mimeType: string;
      type: string;
      parentId?: string;
    }

    interface ResponseObject {
      action: string;
      docs: DocumentObject[];
    }

    const Response: { ACTION: string; DOCUMENTS: string };
    const Document: { ID: string; NAME: string; MIME_TYPE: string; PARENT_ID: string };

    class DocsView {
      constructor(viewId?: string);
      setIncludeFolders(included: boolean): DocsView;
      setSelectFolderEnabled(enabled: boolean): DocsView;
      setMimeTypes(mimeTypes: string): DocsView;
      setParent(parentId: string): DocsView;
      setOwnedByMe(ownedByMe: boolean): DocsView;
    }

    interface Picker {
      setVisible(visible: boolean): void;
      dispose(): void;
    }

    class PickerBuilder {
      addView(view: DocsView | string): PickerBuilder;
      setOAuthToken(token: string): PickerBuilder;
      setDeveloperKey(key: string): PickerBuilder;
      setAppId(appId: string): PickerBuilder;
      setTitle(title: string): PickerBuilder;
      setCallback(callback: (data: ResponseObject) => void): PickerBuilder;
      enableFeature(feature: string): PickerBuilder;
      build(): Picker;
    }
  }
}

// ---- gapi loader (only used to pull in the picker module) -----------------

interface GapiClientLoad {
  load(apiName: string, callback: () => void): void;
}

declare const gapi: GapiClientLoad;

interface Window {
  gapi?: GapiClientLoad;
}
